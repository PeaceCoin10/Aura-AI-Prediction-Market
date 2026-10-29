#!/usr/bin/env python3
"""
hermes_brain.py -- fully automated AI prediction-market brain (create / market / settle)

Three engines run in one process and share a single state file:

  1) Creator Engine   : fetch real quotes -> draft the market question -> createMarket + seedLiquidity
  2) Marketing Engine : every new market automatically gets a Twitter / Telegram copy pack
  3) Oracle & Resolver: settle with real market data once due; use emergencyRefund if nobody can

Design rules (important):
  * Depends only on the python3 standard library plus an installed `cast` (foundry) -- no
    web3/eth-account, no extra packages.
  * Every chain write is decided locally first, and the decision plus the back-end data is
    persisted (state + audit log) so it can be replayed.
  * Under --dry-run nothing is sent: it only prints what would happen. Always run it before going live.
  * Quote unavailable, data too stale, question already exists, balance too low -- skip and log a
    WARN, never guess an outcome.
  * Copy generation uses the local template engine by default; a model is used only when an LLM key
    is configured, and a failed call falls back to templates (never fakes "AI generated").

Usage:
  export RPC_URL=https://sepolia.base.org
  export ENGINE=0x...            # CentralPredictionEngine address
  export BRAIN_PK=0x...          # key for create/settle (must be setCreator / setOracle approved)
  export USDC=0x...              # collateral token
  python3 hermes_brain.py --once --dry-run
  python3 hermes_brain.py --once
  python3 hermes_brain.py --interval 300
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:  # running the script directly / unit tests from inside hermes/
    from verticals import (  # noqa: F401
        EsportsFeed, NewsFeed, SportsFeed, VerticalCandidate, VerticalPlanner,
        VERTICALS, validate_binary_question,
    )
except ImportError:  # imported as a package (hermes.hermes_brain)
    from .verticals import (  # type: ignore  # noqa: F401
        EsportsFeed, NewsFeed, SportsFeed, VerticalCandidate, VerticalPlanner,
        VERTICALS, validate_binary_question,
    )

# --------------------------------------------------------------------------------------
# Tunable constants
# --------------------------------------------------------------------------------------

TRADE_FEE_BPS = 150
MIN_SEED_USDC = 100.0  # market-making seed injected into every new market (USDC)
DEFAULT_HORIZON_H = 24  # default market lifetime in hours
MAX_HORIZON_H = 168
PRICE_MAX_AGE_S = 300  # a quote older than 5 minutes is stale and never used to settle
CREATE_PER_CYCLE = 1  # max new markets per cycle (keeps the feed from flooding)
STATE_TTL_DAYS = 45  # markets older than this may be archived out of the state file

ASSETS = [
    # symbol, coingecko id
    ("BTC", "bitcoin"),
    ("ETH", "ethereum"),
    ("SOL", "solana"),
]

OUTCOME_NO, OUTCOME_YES, OUTCOME_INVALID = 0, 1, 2

log = logging.getLogger("hermes")


# --------------------------------------------------------------------------------------
# Quotes
# --------------------------------------------------------------------------------------


@dataclass
class Quote:
    symbol: str
    price: float
    fetched_at: float
    source: str

    @property
    def age_s(self) -> float:
        return time.time() - self.fetched_at


class PriceFeed:
    """Real quotes. Two sources back each other up; if both fail return None (never invent a number)."""

    def __init__(self, timeout: int = 8):
        self.timeout = timeout

    def _get_json(self, url: str) -> Any:
        req = urllib.request.Request(url, headers={"User-Agent": "hermes-brain/1.0"})
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read().decode())

    def spot(self, symbol: str, cg_id: str) -> Quote | None:
        # 1) CoinGecko
        try:
            url = (
                "https://api.coingecko.com/api/v3/simple/price"
                f"?ids={cg_id}&vs_currencies=usd&precision=2"
            )
            data = self._get_json(url)
            px = float(data[cg_id]["usd"])
            if px > 0:
                return Quote(symbol, px, time.time(), "coingecko")
        except (urllib.error.URLError, KeyError, ValueError, TimeoutError) as exc:
            log.warning("coingecko %s failed: %s", symbol, exc)

        # 2) Binance
        try:
            url = f"https://api.binance.com/api/v3/ticker/price?symbol={symbol}USDT"
            data = self._get_json(url)
            px = float(data["price"])
            if px > 0:
                return Quote(symbol, px, time.time(), "binance")
        except (urllib.error.URLError, KeyError, ValueError, TimeoutError) as exc:
            log.warning("binance %s failed: %s", symbol, exc)
        return None


# --------------------------------------------------------------------------------------
# Chain access (everything through cast, zero SDK dependencies)
# --------------------------------------------------------------------------------------


class ChainError(RuntimeError):
    pass


_NUM_RE = re.compile(r"-?\d+")


def _as_int(field: str) -> int:
    """cast may return '1793128834 [1.793e9]'; keep only the leading integer body."""
    m = _NUM_RE.search(field.replace(",", ""))
    if not m:
        raise ChainError(f"cannot parse integer from {field!r}")
    return int(m.group(0))


def _split_fields(raw: str) -> list[str]:
    """cast returns an inline tuple for a struct and one line per value for multiple returns;
    both shapes must parse."""
    raw = raw.strip()
    if raw.startswith("(") and raw.endswith(")"):
        raw = raw[1:-1]
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    if len(lines) > 1:  # one return value per line
        return lines
    return [p.strip() for p in raw.split(",")]


class Chain:
    def __init__(self, rpc_url: str, engine: str, pk: str | None, dry_run: bool):
        self.rpc = rpc_url
        self.engine = engine
        self.pk = pk
        self.dry_run = dry_run

    # ---- basics ----
    @staticmethod
    def _run(args: list[str], timeout: int = 120) -> str:
        env = dict(os.environ)
        # cast needs a direct RPC connection; keep http_proxy from intercepting local/test networks
        for key in ("http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
            env.pop(key, None)
        proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
        if proc.returncode != 0:
            raise ChainError(f"{' '.join(args[:3])}... failed: {proc.stderr.strip()[:400]}")
        return proc.stdout.strip()

    def call(self, sig: str, *args: str) -> str:
        cmd = ["cast", "call", self.engine, sig, *args, "--rpc-url", self.rpc]
        return self._run(cmd)

    def call_int(self, sig: str, *args: str) -> int:
        out = self.call(sig, *args).strip().strip('"')
        try:
            return int(out, 0)
        except ValueError:
            return 0

    def send(self, sig: str, *args: str) -> str:
        if self.dry_run:
            log.info("[dry-run] would send %s(%s)", sig, ", ".join(args))
            return "0x(dry-run)"
        if not self.pk:
            raise ChainError("BRAIN_PK is required to send transactions")
        cmd = [
            "cast", "send", self.engine, sig, *args,
            "--private-key", self.pk,
            "--rpc-url", self.rpc,
        ]
        out = self._run(cmd, timeout=180)
        for line in out.splitlines():
            if line.startswith("transactionHash"):
                return line.split()[-1]
        return out.splitlines()[0] if out else "0x"

    def block_timestamp(self) -> int:
        """On-chain time (authoritative). After an anvil time warp the wall clock lags, so
        time.time() must not be used to decide whether a market is due."""
        try:
            out = self._run(["cast", "block", "latest", "--field", "timestamp", "--rpc-url", self.rpc], timeout=30)
            return _as_int(out)
        except (ChainError, ValueError, IndexError):
            log.warning("cannot read chain timestamp, fallback to wall clock")
            return int(time.time())

    def resolution_state(self, market_id: str) -> tuple[bool, bool, bool, int, int, int]:
        """(resolved, finalized, disputing, outcome, disputeEndsAt, owed)"""
        payload = self.call("resolutionState(bytes32)(bool,bool,bool,uint8,uint256,uint256)", market_id)
        parts = _split_fields(payload)
        if len(parts) != 6:
            raise ChainError(f"unexpected resolutionState payload: {payload[:160]}")
        return (
            parts[0].split()[0].lower() == "true",
            parts[1].split()[0].lower() == "true",
            parts[2].split()[0].lower() == "true",
            _as_int(parts[3]),
            _as_int(parts[4]),
            _as_int(parts[5]),
        )

    def keccak(self, text: str) -> str:
        return self._run(["cast", "keccak", text]).strip()

    # ---- engine views ----
    def market_count(self) -> int:
        return self.call_int("marketCount()(uint256)")

    CORE_SIG = (
        "marketCore(bytes32)((uint256,uint256,uint256,uint256,uint256,uint256,uint256,"
        "address,uint8,bool,bool))"
    )

    def core(self, market_id: str) -> dict[str, Any]:
        """Parse the Core struct: 7 uint256 + address + uint8 + 2 bool (11 fields total)."""
        payload = self.call(self.CORE_SIG, market_id)
        parts = _split_fields(payload)
        if len(parts) != 11:
            raise ChainError(f"unexpected marketCore payload: {payload[:200]}")
        return {
            "yes_reserve": _as_int(parts[0]),
            "no_reserve": _as_int(parts[1]),
            "cash": _as_int(parts[2]),
            "owed": _as_int(parts[3]),
            "volume": _as_int(parts[4]),
            "resolution_time": _as_int(parts[5]),
            "created_at": _as_int(parts[6]),
            "creator": parts[7].split()[0] if parts[7].split() else parts[7],
            "outcome": _as_int(parts[8]),
            "resolved": parts[9].split()[0].lower() == "true",
            "exists": parts[10].split()[0].lower() == "true",
        }

    def question(self, market_id: str) -> str:
        return self.call("marketQuestion(bytes32)(string)", market_id).strip().strip('"')

    def price_yes(self, market_id: str) -> float:
        raw = self.call("priceYes(bytes32)(uint256)", market_id).split()[0]
        return int(raw) / 1e18

    def usdc_allowance(self, owner: str) -> int:
        usdc = os.environ.get("USDC", "")
        out = self._run([
            "cast", "call", usdc, "allowance(address,address)(uint256)", owner, self.engine,
            "--rpc-url", self.rpc,
        ])
        return _as_int(out)

    def ensure_allowance(self, min_amount: int) -> None:
        """The engine must be allowed to pull USDC before market making -- without this step
        seedLiquidity always fails."""
        who = self.address()
        if self.usdc_allowance(who) >= min_amount:
            return
        if self.dry_run:
            log.info("[dry-run] would approve USDC for engine")
            return
        log.info("approving USDC for engine (one-off, unlimited)")
        self._run([
            "cast", "send", os.environ["USDC"], "approve(address,uint256)", self.engine,
            str(2**256 - 1), "--private-key", self.pk, "--rpc-url", self.rpc,
        ], timeout=180)

    def usdc_balance(self, who: str) -> int:
        usdc = os.environ["USDC"]
        out = self._run(["cast", "call", usdc, "balanceOf(address)(uint256)", who, "--rpc-url", self.rpc])
        return int(out.split()[0])

    def address(self) -> str:
        if not self.pk:
            return "0x0000000000000000000000000000000000000000"
        return self._run(["cast", "wallet", "address", "--private-key", self.pk]).strip()


# --------------------------------------------------------------------------------------
# State
# --------------------------------------------------------------------------------------


@dataclass
class MarketRecord:
    market_id: str
    symbol: str
    question: str
    category: str
    threshold: float
    direction: str  # "above" | "below"
    created_at: int
    resolution_time: int
    seed_usdc: float
    create_tx: str = ""
    resolved: bool = False
    outcome: int = -1
    resolve_tx: str = ""
    # --- multi-vertical extension (defaults keep old state files deserialisable) ---
    vertical: str = "crypto"          # crypto | news | sports | esports
    verification: str = "auto"        # auto (price/score settles it) | manual (human / Safe)
    criteria: str = ""                # objective settlement rule (shown to users)
    payload: dict[str, Any] = field(default_factory=dict)  # raw data needed to settle


@dataclass
class State:
    markets: dict[str, MarketRecord] = field(default_factory=dict)
    last_cycle: int = 0

    @classmethod
    def load(cls, path: Path) -> "State":
        if not path.exists():
            return cls()
        try:
            raw = json.loads(path.read_text())
            return cls(
                markets={k: MarketRecord(**v) for k, v in raw.get("markets", {}).items()},
                last_cycle=raw.get("last_cycle", 0),
            )
        except (json.JSONDecodeError, TypeError) as exc:
            log.error("state file corrupted (%s); starting empty but NOT overwriting history", exc)
            return cls()

    def save(self, path: Path) -> None:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(
            {"markets": {k: asdict(v) for k, v in self.markets.items()}, "last_cycle": self.last_cycle},
            ensure_ascii=False, indent=2,
        ))
        tmp.replace(path)


# --------------------------------------------------------------------------------------
# (1) Creator Engine
# --------------------------------------------------------------------------------------


def nice_round(x: float) -> float:
    """Round a threshold to a human-friendly number (within a 1% step) so questions never read
    like 103847.28."""
    if x >= 10_000:
        return round(x / 500) * 500
    if x >= 1_000:
        return round(x / 50) * 50
    if x >= 100:
        return round(x / 5) * 5
    return round(x, 2)


class CreatorEngine:
    def __init__(self, chain: Chain, feed: PriceFeed, state: State, outbox: Path, seed_usdc: float,
                 horizon_h: int, dry_run: bool, planner: "VerticalPlanner | None" = None,
                 verticals: tuple[str, ...] = ("crypto",), create_per_cycle: int = CREATE_PER_CYCLE):
        self.chain = chain
        self.feed = feed
        self.state = state
        self.outbox = outbox
        self.seed_usdc = seed_usdc
        self.horizon_h = horizon_h
        self.dry_run = dry_run
        self.planner = planner if planner is not None else VerticalPlanner()
        self.verticals = tuple(verticals) or ("crypto",)
        self.create_per_cycle = max(1, int(create_per_cycle))

    def _candidate(self, symbol: str, cg_id: str) -> tuple[dict[str, Any], Quote] | None:
        q = self.feed.spot(symbol, cg_id)
        if q is None:
            return None
        # Threshold sits ~1.5% above spot, rounded up to a friendly number: that is where the
        # market has genuine two-sided interest.
        threshold = nice_round(q.price * 1.015)
        if threshold <= q.price:
            threshold = nice_round(q.price * 1.02)
        question = (
            f"Will {symbol} close above ${threshold:,.0f} within {self.horizon_h} hours? "
            f"Spot ${q.price:,.2f}"
        )
        market_id = self.chain.keccak(question)
        if market_id in self.state.markets:
            log.info("candidate already exists (%s), skip", market_id[:10])
            return None
        return {
            "market_id": market_id,
            "symbol": symbol,
            "question": question,
            "category": "crypto",
            "threshold": threshold,
            "direction": "above",
            "spot": q.price,
            "source": q.source,
            "resolution_time": self.chain.block_timestamp() + self.horizon_h * 3600,
            "horizon_h": self.horizon_h,
        }, q

    # ---------------------------- multi-vertical drafting ----------------------------

    def _crypto_candidates(self, limit: int) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for symbol, cg_id in ASSETS:
            if len(out) >= limit:
                break
            got = self._candidate(symbol, cg_id)
            if got is None:
                continue
            cand, quote = got
            out.append({
                **cand,
                "vertical": "crypto",
                "verification": "auto",
                "criteria": (
                    f"Settled from the {symbol}/USD spot price at the resolution time: CoinGecko "
                    f"is the primary source and Binance the backup; a close at or above "
                    f"${cand['threshold']:,.0f} resolves YES, otherwise NO. If both sources fail, "
                    f"the market resolves INVALID with a full refund."
                ),
                "payload": {"kind": "price", "symbol": symbol, "cg_id": cg_id,
                            "threshold": cand["threshold"], "direction": "above"},
                "quote_source": quote.source,
                "spot": quote.price,
            })
        return out

    def _vertical_candidates(self, vertical: str, limit: int) -> list[dict[str, Any]]:
        if vertical == "crypto":
            return self._crypto_candidates(limit)
        try:
            now = self.chain.block_timestamp()
        except ChainError as exc:
            log.warning("cannot read block timestamp for %s planning: %s", vertical, exc)
            return []
        specs = self.planner.plan(vertical, now, self.horizon_h, limit=limit)
        out: list[dict[str, Any]] = []
        for vc in specs:
            out.append({
                "market_id": self.chain.keccak(vc.fingerprint()),
                "question": vc.question,
                "category": vc.category,
                "resolution_time": vc.resolution_time,
                "threshold": 0.0,
                "direction": "above",
                "symbol": "",
                "vertical": vc.vertical,
                "verification": vc.verification,
                "criteria": vc.criteria,
                "payload": {**vc.payload, "criteria": vc.criteria},
                "source": vc.source,
                "headline": vc.headline,
            })
        return out

    def _create(self, cand: dict[str, Any]) -> dict[str, Any] | None:
        log.info("creating [%s] market: %s", cand.get("vertical", "crypto"), cand["question"])
        try:
            tx = self.chain.send(
                "createMarketWithMeta(bytes32,string,string,uint256)",
                cand["market_id"],
                cand["question"],
                cand["category"],
                str(cand["resolution_time"]),
            )
            seed_raw = int(round(self.seed_usdc * 1_000_000))
            seed_tx = self.chain.send("seedLiquidity(bytes32,uint256)", cand["market_id"], str(seed_raw))
        except ChainError as exc:
            log.error("create failed for %s: %s", cand["market_id"][:12], exc)
            return None

        rec = MarketRecord(
            market_id=cand["market_id"],
            symbol=cand.get("symbol", ""),
            question=cand["question"],
            category=cand["category"],
            threshold=float(cand.get("threshold", 0.0)),
            direction=cand.get("direction", "above"),
            created_at=int(time.time()),
            resolution_time=int(cand["resolution_time"]),
            seed_usdc=self.seed_usdc,
            create_tx=tx,
            vertical=cand.get("vertical", "crypto"),
            verification=cand.get("verification", "auto"),
            criteria=cand.get("criteria", ""),
            payload=cand.get("payload", {}),
        )
        self.state.markets[rec.market_id] = rec
        if not self.dry_run:
            self.state.save(self.outbox.parent / "hermes_state.json")
        log.info("created %s [%s] tx=%s", cand["market_id"][:12], rec.vertical, tx)
        return {**cand, "tx": tx, "seed_tx": seed_tx}

    def _plan_only(self) -> None:
        """With no funds the brain cannot create, but the cycle should still log which questions
        it would have opened, so operators can see drafting is healthy."""
        cursor = int(self.state.last_cycle // 600)
        for vertical in VerticalPlanner.rotation(cursor, self.verticals):
            try:
                cands = self._vertical_candidates(vertical, 1)
            except Exception as exc:  # noqa: BLE001
                log.warning("plan-only %s failed: %s", vertical, exc)
                continue
            for cand in cands:
                log.info("[plan-only] [%s/%s] %s  (resolves %s, verification %s)",
                         vertical, cand.get("category", ""), cand["question"],
                         datetime.fromtimestamp(int(cand["resolution_time"]), timezone.utc).isoformat(),
                         cand.get("verification", "auto"))

    def run(self) -> list[dict[str, Any]]:
        """Create markets in vertical rotation: crypto / news / sports / esports each get a shot
        every cycle where possible."""
        created: list[dict[str, Any]] = []
        seed_raw = int(round(self.seed_usdc * 1_000_000))
        budget = self.create_per_cycle

        if not self.dry_run:
            try:
                bal = self.chain.usdc_balance(self.chain.address())
                affordable = int(bal // seed_raw) if seed_raw > 0 else 0
                if affordable <= 0:
                    log.error(
                        "insufficient USDC for seeding: have %.2f, need %.2f - skip creating",
                        bal / 1e6, self.seed_usdc,
                    )
                    self._plan_only()
                    return []
                if affordable < budget:
                    log.warning("wallet only covers %d market seed(s) (balance %.2f USDC); "
                                "creating %d this cycle", affordable, bal / 1e6, affordable)
                budget = min(budget, affordable)
                self.chain.ensure_allowance(seed_raw * budget)
            except ChainError as exc:
                log.error("pre-flight check failed: %s", exc)
                return []

        cursor = int(self.state.last_cycle // 600)  # one slot every 10 minutes keeps rotation moving
        order = VerticalPlanner.rotation(cursor, self.verticals)
        # Reserve one slot per vertical first, then spend the remaining budget -- otherwise crypto
        # eats the whole budget and the other verticals never get drafted.
        cap = 1 if len(order) > 1 else budget
        plans: dict[str, list[dict[str, Any]]] = {}
        for vertical in order:
            try:
                plans[vertical] = self._vertical_candidates(vertical, cap)
            except Exception as exc:  # noqa: BLE001 - one failing vertical must not stop the others
                log.warning("planning %s failed: %s", vertical, exc)
                plans[vertical] = []
            if not plans[vertical]:
                log.info("vertical %s: no qualifying new question this cycle", vertical)

        while len(created) < budget:
            progressed = False
            for vertical in order:
                if len(created) >= budget:
                    break
                cands = plans.get(vertical) or []
                if not cands:
                    continue
                cand = cands.pop(0)
                progressed = True
                if cand["market_id"] in self.state.markets:
                    log.info("%s candidate already exists (%s), skip", vertical, cand["market_id"][:10])
                    continue
                rec = self._create(cand)
                if rec is not None:
                    created.append(rec)
            if not progressed:
                break

        if not created:
            log.info("no new market this cycle (verticals=%s)", ",".join(self.verticals))
        return created


# --------------------------------------------------------------------------------------
# (2) Marketing Engine
# --------------------------------------------------------------------------------------


class MarketingEngine:
    """
    Generate the Twitter / Telegram copy.
    Template engine by default (deterministic, reviewable); a model is called only when an LLM key
    is configured, and a failed call falls back to the templates.
    """

    def __init__(self, outbox: Path, base_url: str, dry_run: bool):
        self.outbox = outbox
        self.base_url = base_url.rstrip("/")
        self.dry_run = dry_run

    # ---- templates ----
    @staticmethod
    def _odds(threshold: float, spot: float) -> str:
        gap = (threshold - spot) / spot * 100 if spot else 0
        return f"{gap:+.1f}%"

    def template_copy(self, m: dict[str, Any]) -> dict[str, str]:
        sym = m["symbol"]
        thr = m["threshold"]
        spot = m.get("spot", 0)
        link = f"{self.base_url}/m/{m['market_id']}"
        gap = self._odds(thr, spot)
        hours = m.get("horizon_h", DEFAULT_HORIZON_H)

        tw = (
            f"New market live: will {sym} close above ${thr:,.0f} within {hours}h?\n\n"
            f"Spot ${spot:,.2f} ({gap} to target)\n"
            f"Market depth {m.get('seed_usdc', MIN_SEED_USDC):.0f} USDC | tickets 5-10,000 USDC\n"
            f"Prices move with every fill; early entries get the better price.\n\n"
            f"Trade: {link}\n"
            f"#predictionmarket #{sym} #Base"
        )
        tg = (
            f"**New market | will {sym} close above ${thr:,.0f}?**\n\n"
            f"- Spot: ${spot:,.2f}  |  distance to target: {gap}\n"
            f"- Window: {hours} hours (settled automatically by the Hermes oracle when due)\n"
            f"- 1.5% trading fee, 0.5% settlement fee for winners, auto-refund after 7 days overdue\n"
            f"- Min 5 / max 10,000 USDC per ticket, 5% price-impact cap (whale protection)\n\n"
            f"Enter: {link}"
        )
        analysis = (
            f"Why this market is worth a look: {sym} trades at ${spot:,.2f} against a "
            f"${thr:,.0f} target ({gap}). Over a {hours}-hour window that move needs a real "
            f"catalyst (ETF flows, macro data, a liquidation cascade). If you think volatility is "
            f"underpriced, YES is fairly cheap; if you believe in mean reversion, NO pays the carry."
        )
        return {"twitter": tw, "telegram": tg, "analysis": analysis, "link": link}

    # ---- optional LLM ----
    def llm_copy(self, m: dict[str, Any], fallback: dict[str, str]) -> dict[str, str]:
        key, base, model = (
            os.getenv("LLM_API_KEY") or os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY"),
            os.getenv("LLM_BASE_URL", "https://api.deepseek.com/v1"),
            os.getenv("LLM_MODEL", "deepseek-chat"),
        )
        if not key:
            return fallback
        prompt = (
            "You are the community lead for a crypto prediction market. Write three pieces of copy "
            "for the market below:\n"
            "1) one Twitter post of at most 280 characters (include the link and 2 hashtags, never "
            "invent data)\n"
            "2) one Telegram rich-text post (bullet points)\n"
            "3) one betting-logic analysis of at most 120 words (only from the facts given)\n"
            f"Market: {m['question']}\nSpot: {m.get('spot')}\nThreshold: {m['threshold']}\n"
            f"Window: {m.get('horizon_h')} hours\nLink: {fallback['link']}\n"
            "Respond in English. Output strictly JSON: {\"twitter\":...,\"telegram\":...,\"analysis\":...}"
        )
        body = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
        }).encode()
        req = urllib.request.Request(
            f"{base.rstrip('/')}/chat/completions",
            data=body,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read().decode())
            text = payload["choices"][0]["message"]["content"]
            start, end = text.find("{"), text.rfind("}")
            data = json.loads(text[start:end + 1])
            return {
                "twitter": str(data["twitter"]),
                "telegram": str(data["telegram"]),
                "analysis": str(data["analysis"]),
                "link": fallback["link"],
                "generated_by": f"llm:{model}",
            }
        except (urllib.error.URLError, KeyError, ValueError, TimeoutError) as exc:
            log.warning("LLM copy failed (%s), falling back to templates", exc)
            return fallback

    # ---- publish ----
    def publish(self, m: dict[str, Any]) -> dict[str, str]:
        fallback = self.template_copy(m)
        copy = self.llm_copy(m, fallback)
        copy.setdefault("generated_by", "template")

        self.outbox.mkdir(parents=True, exist_ok=True)
        path = self.outbox / f"{m['market_id'][:12]}.md"
        if self.dry_run:
            path = self.outbox / f"DRYRUN-{m['market_id'][:12]}.md"
        path.write_text(
            f"# {m['question']}\n\n"
            f"- market_id: `{m['market_id']}`\n- spot: {m.get('spot')}\n- threshold: {m['threshold']}\n"
            f"- resolves: {datetime.fromtimestamp(m['resolution_time'], timezone.utc).isoformat()}\n"
            f"- copy source: {copy['generated_by']}\n\n"
            f"## Twitter\n\n```\n{copy['twitter']}\n```\n\n"
            f"## Telegram\n\n{copy['telegram']}\n\n"
            f"## Betting logic\n\n{copy['analysis']}\n",
            encoding="utf-8",
        )
        log.info("marketing copy written: %s", path)
        self._telegram(copy["telegram"])
        return copy

    def _telegram(self, text: str) -> None:
        token, chat = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
        if not (token and chat):
            return
        if self.dry_run:
            log.info("[dry-run] would post to telegram chat %s", chat)
            return
        data = urllib.parse.urlencode({
            "chat_id": chat, "text": text, "parse_mode": "Markdown", "disable_web_page_preview": "true",
        }).encode()
        try:
            req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data)
            with urllib.request.urlopen(req, timeout=30) as resp:
                log.info("telegram posted: %s", resp.status)
        except (urllib.error.URLError, TimeoutError) as exc:
            log.warning("telegram post failed: %s", exc)


# --------------------------------------------------------------------------------------
# (3) Oracle & Resolver Engine
# --------------------------------------------------------------------------------------


class OracleEngine:
    """Settlement engine: wick protection comes from multi-sampling -- take several quotes in a
    row and only settle on-chain when every one agrees."""

    def __init__(self, chain: Chain, feed: PriceFeed, state: State, proposals: Path,
                 require_confirm: bool, dry_run: bool, refund_grace_s: int = 7 * 86400,
                 confirm_samples: int = 3, confirm_gap_s: int = 30,
                 sports: "SportsFeed | None" = None, esports: "EsportsFeed | None" = None):
        self.chain = chain
        self.feed = feed
        self.state = state
        self.proposals = proposals
        self.require_confirm = require_confirm
        self.dry_run = dry_run
        self.refund_grace_s = refund_grace_s
        self.sports = sports if sports is not None else SportsFeed()
        self.esports = esports if esports is not None else EsportsFeed()
        # Wick protection: 3 samples 30s apart by default, all three must agree before resolveMarket
        self.confirm_samples = max(1, int(confirm_samples))
        self.confirm_gap_s = max(0, int(confirm_gap_s))

    # ---------------------------- multi-sampling ----------------------------

    def _verdict(self, rec: MarketRecord, price: float) -> int:
        if rec.direction == "above":
            return OUTCOME_YES if price >= rec.threshold else OUTCOME_NO
        return OUTCOME_YES if price <= rec.threshold else OUTCOME_NO

    def _decide_external(self, rec: MarketRecord, kind: str) -> tuple[str, int | None, str]:
        """Sports / esports: only the official final result counts; skip if it is not in yet
        (never guess)."""
        if kind == "espn":
            league = str((rec.payload or {}).get("league", ""))
            event_id = str((rec.payload or {}).get("event_id", ""))
            winner = self.sports.winner(league, event_id) if league and event_id else None
            if winner is None:
                return "skip", None, f"ESPN {league}/{event_id} not final or score missing; wait for the next cycle"
            outcome = OUTCOME_YES if winner == "home" else OUTCOME_NO
            return ("resolve", outcome,
                    f"settled on the ESPN final score: {rec.payload.get('home')} vs {rec.payload.get('away')} -> {winner}")
        if kind == "lolesports":
            match_id = str((rec.payload or {}).get("match_id", ""))
            winner = self.esports.winner(match_id) if match_id else None
            if winner is None:
                return "skip", None, "LoL Esports result not final yet; wait for the next cycle"
            outcome = OUTCOME_YES if winner == "a" else OUTCOME_NO
            return ("resolve", outcome,
                    f"settled on LoL Esports gameWins: {rec.payload.get('team_a')} vs {rec.payload.get('team_b')} -> {winner}")
        return "keep", None, f"unknown verification kind: {kind}"

    def _sample(self, rec: MarketRecord) -> tuple[list[Quote], str]:
        """Take confirm_samples quotes in a row; any failure or stale quote is not a confirmation."""
        cg_id = dict((sym, cg) for sym, cg in ASSETS).get(rec.symbol)
        quotes: list[Quote] = []
        for i in range(self.confirm_samples):
            q = self.feed.spot(rec.symbol, cg_id)
            if q is None:
                return [], f"sample {i + 1}/{self.confirm_samples} unavailable"
            if q.age_s > PRICE_MAX_AGE_S:
                return [], f"stale quote ({q.age_s:.0f}s)"
            quotes.append(q)
            log.info(
                "[oracle] %s sample %d/%d: %s = %s (%s)",
                rec.market_id[:12], i + 1, self.confirm_samples, rec.symbol,
                f"{q.price:,.2f}", q.source,
            )
            if i + 1 < self.confirm_samples and self.confirm_gap_s > 0:
                log.info("[oracle] %s waiting %ds before the next sample", rec.market_id[:12], self.confirm_gap_s)
                time.sleep(self.confirm_gap_s)
        return quotes, ""

    def _decide(self, rec: MarketRecord) -> tuple[str, int | None, str]:
        """Return (action, outcome, reason); action is one of keep/resolve/refund/skip."""
        now = self.chain.block_timestamp()
        if rec.resolved:
            return "keep", None, "already resolved"
        if now < rec.resolution_time:
            return "keep", None, "not due yet"

        kind = str((rec.payload or {}).get("kind", "price"))
        # News / geopolitics / tech: "did an official respond" cannot be proven from RSS -- propose
        # only, never auto-settle.
        if rec.verification == "manual" or kind == "manual":
            return "keep", None, "manual settlement (news/geopolitics) - awaiting Oracle/Safe decision"
        if kind in ("espn", "lolesports"):
            return self._decide_external(rec, kind)

        quotes, err = self._sample(rec)
        if not quotes:
            if err.startswith("stale quote"):
                return "skip", None, err
            if now >= rec.resolution_time + self.refund_grace_s:
                return "refund", OUTCOME_INVALID, "price feed dead past refund window -> INVALID/refund"
            return "skip", None, f"price feed unavailable, wait ({err})"

        verdicts = [self._verdict(rec, q.price) for q in quotes]
        if len(set(verdicts)) > 1:
            path = " -> ".join(f"{q.price:,.2f}" for q in quotes)
            return "skip", None, f"price flipped inside confirmation window [{path}] - wait, do not settle"

        outcome = verdicts[0]
        lo = min(q.price for q in quotes)
        hi = max(q.price for q in quotes)
        if lo == hi:
            shown = f"{lo:,.2f}"
        else:
            shown = f"{lo:,.2f}~{hi:,.2f}"
        return (
            "resolve",
            outcome,
            f"{rec.symbol} spot {shown} vs threshold {rec.threshold:,.0f} "
            f"({quotes[0].source}, {len(quotes)}/{self.confirm_samples} confirmed)",
        )

    def run(self) -> list[dict[str, Any]]:
        results = []
        for mid, rec in list(self.state.markets.items()):
            action, outcome, reason = self._decide(rec)
            if action == "keep":
                continue
            log.info("[oracle] %s -> %s (%s)", mid[:12], action, reason)

            if self.require_confirm:
                self.proposals.mkdir(parents=True, exist_ok=True)
                p = self.proposals / f"{mid[:12]}-{action}.json"
                p.write_text(json.dumps({
                    "market_id": mid, "question": rec.question, "action": action,
                    "outcome": outcome, "reason": reason, "proposed_at": int(time.time()),
                }, ensure_ascii=False, indent=2))
                log.info("[oracle] proposal written for human confirmation: %s", p)
                results.append({"market_id": mid, "action": "proposed", "reason": reason})
                continue

            if action == "skip":
                results.append({"market_id": mid, "action": "skip", "reason": reason})
                continue

            try:
                if action == "resolve":
                    tx = self.chain.send("resolveMarket(bytes32,uint8)", mid, str(outcome))
                else:
                    tx = self.chain.send("emergencyRefund(bytes32)", mid)
            except ChainError as exc:
                log.error("[oracle] settle failed for %s: %s", mid, exc)
                results.append({"market_id": mid, "action": "error", "reason": str(exc)})
                continue

            rec.resolved = True
            rec.outcome = int(outcome if outcome is not None else OUTCOME_INVALID)
            rec.resolve_tx = tx
            if not self.dry_run:
                self.state.save(self.proposals.parent / "hermes_state.json")

            dispute_ends_at = None
            try:
                _resolved, finalized, disputing, _oc, ends_at, _owed = self.chain.resolution_state(mid)
                dispute_ends_at = ends_at or None
                if disputing:
                    log.info(
                        "[oracle] %s in dispute window until %s (Safe can still override)",
                        mid[:12], datetime.fromtimestamp(ends_at, timezone.utc).isoformat(),
                    )
            except (ChainError, ValueError, IndexError, TypeError):
                pass  # status reporting only; a failed read never changes the settlement result

            results.append({"market_id": mid, "action": action, "outcome": rec.outcome,
                            "reason": reason, "tx": tx, "dispute_ends_at": dispute_ends_at})
        return results


# --------------------------------------------------------------------------------------
# Main loop
# --------------------------------------------------------------------------------------


def setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )


def cycle(args: argparse.Namespace) -> dict[str, Any]:
    root = Path(args.workdir).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    outbox, proposals = root / "outbox", root / "proposals"
    state_path = root / "hermes_state.json"

    chain = Chain(args.rpc_url, args.engine, args.pk, args.dry_run)
    feed = PriceFeed()
    state = State.load(state_path)

    planner = VerticalPlanner(news=NewsFeed(), sports=SportsFeed(), esports=EsportsFeed())
    verticals = tuple(v.strip() for v in str(getattr(args, "verticals", "crypto,news,sports,esports")).split(",") if v.strip())
    verticals = tuple(v for v in verticals if v in VERTICALS) or ("crypto",)

    report: dict[str, Any] = {"at": datetime.now(timezone.utc).isoformat(), "dry_run": args.dry_run,
                              "verticals": list(verticals)}

    if not args.oracle_only:
        creator = CreatorEngine(
            chain, feed, state, outbox, args.seed_usdc, args.horizon_hours, args.dry_run,
            planner=planner, verticals=verticals,
            create_per_cycle=int(getattr(args, "create_per_cycle", CREATE_PER_CYCLE)),
        )
        created = creator.run()
        report["created"] = created
        if created and not args.no_marketing:
            mk = MarketingEngine(outbox, args.base_url, args.dry_run)
            report["marketing"] = [mk.publish(c) for c in created]

    if not args.creator_only:
        oracle = OracleEngine(
            chain, feed, state, proposals, args.require_confirm, args.dry_run,
            confirm_samples=args.confirm_samples, confirm_gap_s=args.confirm_gap,
            sports=planner.sports, esports=planner.esports,
        )
        report["settlements"] = oracle.run()

    state.last_cycle = int(time.time())
    if not args.dry_run:
        state.save(state_path)
    else:
        log.info("[dry-run] state not persisted (nothing was actually created)")

    # ---- AI brain commentary: real pools + headline sentiment -> pollable insights.json ----
    insights_out = os.environ.get("INSIGHTS_OUT", "").strip()
    if insights_out:
        try:
            from insights import generate as _gen_insights  # deferred import, avoids a cycle
            payload = _gen_insights(root, Path(insights_out), args.rpc_url, args.engine)
            log.info("insights: %d markets -> %s", len(payload.get("items", {})), insights_out)
        except Exception as exc:  # noqa: BLE001 - commentary must not break create/settle
            log.warning("insights generation failed: %s", exc)

    (root / "logs").mkdir(exist_ok=True)
    with (root / "logs" / "cycles.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(report, ensure_ascii=False) + "\n")
    return report


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Hermes automated prediction-market brain (create / market / settle)")
    p.add_argument("--rpc-url", default=os.getenv("RPC_URL", "https://sepolia.base.org"))
    p.add_argument("--engine", default=os.getenv("ENGINE", ""), help="CentralPredictionEngine address")
    p.add_argument("--pk", default=os.getenv("BRAIN_PK"), help="key for create/settle (env var wins)")
    p.add_argument("--workdir", default=os.getenv("BRAIN_WORKDIR", "./hermes-runtime"))
    p.add_argument("--seed-usdc", type=float, default=float(os.getenv("SEED_USDC", MIN_SEED_USDC)))
    p.add_argument("--horizon-hours", type=int, default=int(os.getenv("HORIZON_HOURS", DEFAULT_HORIZON_H)))
    p.add_argument("--base-url", default=os.getenv("SITE_URL", "https://predict.example.com"))
    p.add_argument("--verticals", default=os.getenv("VERTICALS", "crypto,news,sports,esports"),
                   help="enabled verticals, comma separated: crypto,news,sports,esports")
    p.add_argument("--create-per-cycle", type=int,
                   default=int(os.getenv("CREATE_PER_CYCLE", "3")),
                   help="max markets created per cycle (default 3, in vertical rotation)")
    p.add_argument("--interval", type=int, default=0, help=">0 runs as a resident loop (seconds)")
    p.add_argument("--once", action="store_true", help="run a single cycle")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--creator-only", action="store_true")
    p.add_argument("--oracle-only", action="store_true")
    p.add_argument("--no-marketing", action="store_true")
    p.add_argument("--require-confirm", action="store_true", help="settlement only writes a proposal for review")
    p.add_argument("--confirm-samples", type=int, default=int(os.getenv("ORACLE_CONFIRM_SAMPLES", 3)),
                   help="consecutive price samples before settling (default 3)")
    p.add_argument("--confirm-gap", type=int, default=int(os.getenv("ORACLE_CONFIRM_GAP", 30)),
                   help="seconds between samples (default 30)")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    setup_logging(args.verbose)
    if not args.engine:
        log.error("ENGINE address is required (env ENGINE or --engine)")
        return 2
    if not args.dry_run and not args.pk:
        log.error("BRAIN_PK is required unless --dry-run")
        return 2
    if args.horizon_hours < 1 or args.horizon_hours > MAX_HORIZON_H:
        log.error("horizon must be 1..%d hours", MAX_HORIZON_H)
        return 2

    log.info("brain start: engine=%s rpc=%s dry_run=%s interval=%s",
             args.engine, args.rpc_url, args.dry_run, args.interval or "once")

    try:
        if args.interval <= 0:
            report = cycle(args)
            json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
            sys.stdout.write("\n")
            return 0
        while True:
            try:
                cycle(args)
            except ChainError as exc:
                log.error("cycle failed (chain): %s", exc)
            except Exception as exc:  # noqa: BLE001 - a resident process must never die on one bad cycle
                log.exception("cycle failed: %s", exc)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        log.info("stopped by user")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
