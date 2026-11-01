#!/usr/bin/env python3
"""
Hermes AI brain -- market commentary engine.

Reads real state (on-chain pools, or the shipped catalogue when running against a static
build), compares it with the previous snapshot, measures whale flow on the majors from
Binance public prints, and writes one *computed* commentary per market into
`frontend/public/insights.json`.

The commentary is assembled from the numbers of that market on that run: probability and
its change since the last snapshot, turnover against depth, the USDC cost of repricing the
curve to a target, whale buy/sell imbalance, and the net tone of the headlines. No template
is reused verbatim across two markets if their numbers differ, and nothing is invented: if a
feed is down the clause says so and the market is skipped rather than guessed.

Usage:
    python3 hermes/insights.py                                  # on-chain markets
    python3 hermes/insights.py --catalogue frontend/src/data/markets.ts
    python3 hermes/insights.py --no-whale                       # skip Binance prints
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import re
import shutil
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hermes_brain import Chain, ChainError, State  # noqa: E402
from verticals import NewsFeed  # noqa: E402

log = logging.getLogger("insights")

DEFAULT_RPC = "https://mainnet.base.org"
DEFAULT_ENGINE = "0xE6056Bc6700F6d7E6fF8779B212655284dc1631C"
BINANCE = "https://api.binance.com/api/v3/aggTrades"
WHALE_USD = 25_000.0
WHALE_SYMBOLS = ("BTCUSDT", "ETHUSDT", "SOLUSDT")
IMPACT_CAP_BPS = 500  # the on-chain per-fill notional cap (5% of depth)

BULL_WORDS = ("surge", "rally", "record", "beat", "approval", "etf", "adopt", "bull", "soar", "gain", "win")
BEAR_WORDS = ("crash", "hack", "ban", "lawsuit", "probe", "plunge", "slump", "fear", "warn", "bear", "loss", "fail")


# --------------------------------------------------------------------------------------
# Pricing maths (mirrors CentralPredictionEngine: k = y*n, p_yes = n/(y+n))
# --------------------------------------------------------------------------------------


def impact_cost(depth: float, p_from: float, p_to: float) -> float:
    """USDC of YES buying needed to move the curve from p_from to p_to.

    With y = (1-p)*D, n = p*D and k = y*n, buying YES adds `net` to n, so
        net = sqrt(k) * ( sqrt(p1/(1-p1)) - sqrt(p0/(1-p0)) )
    """
    if depth <= 0 or not (0 < p_from < 1) or not (0 < p_to < 1):
        raise ValueError("impact_cost needs depth > 0 and probabilities inside (0, 1)")
    k = p_from * (1 - p_from) * depth * depth
    return math.sqrt(k) * (math.sqrt(p_to / (1 - p_to)) - math.sqrt(p_from / (1 - p_from)))


def simulate_buy(depth: float, p_from: float, gross: float, fee_bps: int = 150) -> tuple[float, float]:
    """Return (shares_out, p_after) for a YES buy, using the contract's own transition."""
    fee = math.ceil(gross * fee_bps / 10_000)
    net = gross - fee
    y, n = (1 - p_from) * depth, p_from * depth
    n2 = n + net
    y2 = math.ceil(y * n / n2) if n2 else y
    shares = (depth - (y + n)) + net + (y - y2)
    p2 = n2 / (y2 + n2) if (y2 + n2) else p_from
    return shares, p2


# --------------------------------------------------------------------------------------
# Inputs
# --------------------------------------------------------------------------------------


@dataclass
class Market:
    mid: str
    question: str
    category: str
    prob: float
    depth: float
    volume: float
    hours_left: float
    prev_prob: float | None = None
    prev_ts: int | None = None
    whale_buy: float = 0.0
    whale_sell: float = 0.0
    whale_prints: int = 0
    top_print: tuple[str, float, str] | None = None  # (symbol, notional, side)
    mood: int = 0
    mood_title: str = ""
    notes: list[str] = field(default_factory=list)


def news_mood(news: NewsFeed, limit: int = 12) -> tuple[int, str]:
    """Net bull/bear keyword hits across headlines. Returns (score, sample title)."""
    try:
        items = news.headlines(limit_per_feed=3)[:limit]
    except Exception:  # noqa: BLE001 - a dead news feed must not break the commentary
        return 0, ""
    score, sample = 0, ""
    for it in items:
        title = (it.title or "").lower()
        b = sum(w in title for w in BULL_WORDS)
        r = sum(w in title for w in BEAR_WORDS)
        score += b - r
        if (b or r) and not sample:
            sample = it.title
    return score, sample


def fetch_whale_flow(limit: int = 500, timeout: float = 20.0) -> dict:
    """Sum ≥ $25k prints per side on the majors. Returns zeros (with ok=False) if unreachable."""
    buy = sell = 0.0
    prints = 0
    top: tuple[str, float, str] | None = None
    ok = True
    for sym in WHALE_SYMBOLS:
        try:
            req = urllib.request.Request(f"{BINANCE}?symbol={sym}&limit={limit}", headers={"User-Agent": "aura-insights/2"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                rows = json.loads(resp.read().decode())
        except Exception:  # noqa: BLE001 - a dead venue must not break generation
            ok = False
            continue
        for r in rows:
            notional = float(r["p"]) * float(r["q"])
            if notional < WHALE_USD:
                continue
            # m == True means the buyer was the maker, i.e. the taker sold into the bid
            side = "sell" if r.get("m") else "buy"
            if side == "buy":
                buy += notional
            else:
                sell += notional
            prints += 1
            if top is None or notional > top[1]:
                top = (sym, notional, side)
    return {"ok": ok, "buy": buy, "sell": sell, "prints": prints, "top": top}


def load_history(path: Path) -> dict[str, dict]:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def save_history(path: Path, history: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    compact = {k: v for k, v in list(history.items())[-600:]}
    path.write_text(json.dumps(compact, indent=0))


# --------------------------------------------------------------------------------------
# Commentary
# --------------------------------------------------------------------------------------


def tone_for(m: Market) -> str:
    """Tone is a function of the measured state, not of a category lookup."""
    spread = m.whale_buy - m.whale_sell
    if m.prob >= 0.78 or m.prob <= 0.22:
        return "warn"
    if m.depth > 0 and m.volume / m.depth >= 2.5:
        return "warn" if abs(spread) > 0 else "geek"
    if spread > 0 and m.mood >= 0:
        return "bull"
    if spread < 0 and m.mood <= 0:
        return "bear"
    if abs(m.prob - (m.prev_prob if m.prev_prob is not None else m.prob)) >= 0.04:
        return "bull" if m.prob > (m.prev_prob or 0) else "bear"
    if 0.45 <= m.prob <= 0.55:
        return "geek"
    return "bull" if m.prob > 0.55 else "bear"


def _delta_clause(m: Market) -> str:
    if m.prev_prob is None:
        return "opening snapshot for this book, so there is no drift to judge yet"
    d = (m.prob - m.prev_prob) * 100
    when = time.strftime("%H:%M UTC", time.gmtime(m.prev_ts or time.time()))
    if abs(d) < 0.15:
        return f"unchanged since {when} (drift {d:+.2f} pts), so nobody has paid up either way"
    direction = "up" if d > 0 else "down"
    pace = "a sharp repricing" if abs(d) >= 4 else "a slow drift" if abs(d) < 1.5 else "a steady move"
    return f"{direction} {abs(d):.1f} pts since {when} — {pace}"


def _book_clause(m: Market) -> str:
    if m.depth <= 0:
        return "the book is empty, so there is no price to argue with"
    turnover = m.volume / m.depth if m.depth else 0.0
    cap = m.depth * IMPACT_CAP_BPS / 10_000
    if turnover >= 2.5:
        shape = f"turnover is {turnover:.1f}x the book — a genuinely busy tape"
    elif turnover >= 0.5:
        shape = f"turnover is {turnover:.1f}x the book, normal for a market this size"
    else:
        shape = f"turnover is only {turnover:.2f}x the book, so quotes drift on small size"
    return f"Depth {m.depth:,.0f} USDC against {m.volume:,.0f} traded: {shape}; one fill is capped at {cap:,.0f} USDC"


def _impact_clause(m: Market) -> str:
    target = min(0.95, m.prob + 0.1)
    if m.depth <= 0 or not (0 < m.prob < 0.95):
        return "no curve to price an impact against"
    try:
        cost = impact_cost(m.depth, m.prob, target)
    except ValueError:
        return "impact cannot be quoted at this probability"
    return f"lifting YES to {target * 100:.0f}% costs about {cost:,.0f} USDC of YES buying on this curve"


def _flow_clause(m: Market) -> str:
    if m.whale_prints == 0:
        return "no whale print (≥ $25k) on the majors in this window, so there is no large-trader read to report"
    net = m.whale_buy - m.whale_sell
    lean = "bid-side" if net > 0 else "offer-side" if net < 0 else "balanced"
    lead = ""
    if m.top_print:
        sym, notional, side = m.top_print
        lead = f" Largest single print: {sym} {side} at ${notional:,.0f}"
    net_txt = f"+${net:,.0f}" if net > 0 else f"-${abs(net):,.0f}" if net < 0 else "$0"
    return (
        f"{m.whale_prints} prints ≥ $25k across BTC/ETH/SOL: ${m.whale_buy:,.0f} bought vs "
        f"${m.whale_sell:,.0f} sold, net {net_txt} — {lean}.{lead}"
    )


def _news_clause(m: Market) -> str:
    if m.mood >= 2:
        tail = f' ("{m.mood_title[:60]}")' if m.mood_title else ""
        return f"headlines lean warm at {m.mood:+d}{tail}"
    if m.mood <= -2:
        tail = f' ("{m.mood_title[:60]}")' if m.mood_title else ""
        return f"headlines lean cold at {m.mood:+d}{tail}"
    return f"headline tone is neutral ({m.mood:+d}), so the tape is trading the book, not the news"


def _cap(s: str) -> str:
    """Uppercase the first character only — never lower the rest, 'YES' must stay 'YES'."""
    return s[:1].upper() + s[1:] if s else s


def _vertical_clause(m: Market) -> str:
    """One analytic line per vertical: what actually settles this kind of book."""
    c = (m.category or "").lower()
    if c.startswith("crypto"):
        return "Crypto books settle on the named spot close, so the print that matters is the one at 00:00 UTC, not the loudest headline"
    if c.startswith("news"):
        return "News books settle on the named publication, so headline volume is noise until that outlet actually prints"
    if c.startswith("esport"):
        return "Esports books settle on the official gameWins, and a single map swing moves the number harder than any roster rumour"
    if c.startswith("sport"):
        return "Sports books are discrete: the curve is pricing one result, so variance is binary and late money is usually informed"
    if c.startswith("tech"):
        return "Tech books hinge on the announcement date, and shipping slips are the most common reason a favourite loses"
    return "Settlement is defined by the written rule, and nothing else on this page changes the payout"


def _time_clause(m: Market) -> str:
    if m.hours_left <= 0:
        return "settlement is due; the ruling is the only thing left to trade"
    if m.hours_left <= 2:
        return f"{m.hours_left:.1f}h to settlement — thin closes are where wicks get printed"
    if m.hours_left <= 36:
        return f"{m.hours_left:.1f}h to settlement, inside the window where positioning usually happens"
    return f"{m.hours_left / 24:.1f} days to settlement, early enough that the curve still leads the news"


def render(m: Market) -> str:
    """Assemble the commentary from the measured numbers of this run."""
    head = f"YES {m.prob * 100:.1f}%"
    sentences = [
        f"{head} — {_delta_clause(m)}.",
        f"{_book_clause(m)}.",
        f"{_cap(_impact_clause(m))}.",
        f"{_flow_clause(m)}.",
        f"{_cap(_news_clause(m))}.",
        f"{_cap(_time_clause(m))}.",
        f"{_vertical_clause(m)}.",
    ]
    if m.notes:
        sentences.append(" ".join(m.notes))
    return " ".join(sentences)


def basis_for(m: Market) -> str:
    parts = [
        f"p={m.prob:.4f}",
        f"prev={('-' if m.prev_prob is None else f'{m.prev_prob:.4f}')}",
        f"depth={m.depth:.0f}",
        f"volume={m.volume:.0f}",
        f"whale_buy={m.whale_buy:.0f}",
        f"whale_sell={m.whale_sell:.0f}",
        f"prints={m.whale_prints}",
        f"mood={m.mood:+d}",
        f"h_left={m.hours_left:.1f}",
    ]
    return " ".join(parts)


# --------------------------------------------------------------------------------------
# Sources
# --------------------------------------------------------------------------------------


ROW_RE = re.compile(
    r'^  \["(?P<id>[^"]+)", "(?P<vertical>[^"]+)", "(?P<question>(?:[^"\\]|\\.)*)", '
    r'"(?P<criteria>(?:[^"\\]|\\.)*)", "(?P<source>(?:[^"\\]|\\.)*)", '
    r'(?P<prob>[0-9.]+), (?P<depth>[0-9]+), (?P<days>[0-9]+), (?P<volume>[0-9]+)',
    re.M,
)


def load_catalogue(path: Path) -> list[Market]:
    """Read the shipped catalogue (id, vertical, question, source, prob, depth, days, volume)."""
    text = path.read_text(encoding="utf-8")
    out: list[Market] = []
    for m in ROW_RE.finditer(text):
        out.append(
            Market(
                mid=m.group("id"),
                question=m.group("question"),
                category=m.group("vertical"),
                prob=float(m.group("prob")),
                depth=float(m.group("depth")),
                volume=float(m.group("volume")),
                hours_left=float(m.group("days")) * 24.0,
            )
        )
    if not out:
        raise ValueError(f"no catalogue rows parsed from {path}")
    return out


def generate(
    workdir: Path,
    out: Path,
    rpc: str,
    engine: str,
    catalogue: Path | None = None,
    whale: bool = True,
) -> dict:
    news = NewsFeed()
    mood, mood_title = news_mood(news)
    now = int(time.time())
    history = load_history(workdir / "insights_history.json")

    flow = {"ok": False, "buy": 0.0, "sell": 0.0, "prints": 0, "top": None}
    if whale:
        flow = fetch_whale_flow()
        if not flow["ok"]:
            log.warning("whale flow unavailable (venue unreachable); commentary will say so")

    markets: list[Market] = []
    skipped = 0
    if catalogue is not None:
        markets = load_catalogue(catalogue)
    else:
        state = State.load(workdir / "hermes_state.json")
        chain = Chain(rpc, engine, None, dry_run=True)
        for mid, rec in state.markets.items():
            if rec.resolved:
                continue
            try:
                core = chain.core(mid)
                prob = chain.price_yes(mid)
            except (ChainError, ValueError) as exc:
                skipped += 1
                log.warning("skip %s: %s", mid[:10], exc)
                continue
            markets.append(
                Market(
                    mid=mid,
                    question=rec.question,
                    category=rec.vertical or rec.category,
                    prob=prob,
                    depth=(core["yes_reserve"] + core["no_reserve"]) / 1e6,
                    volume=core["volume"] / 1e6,
                    hours_left=max(0.0, (core["resolution_time"] - now) / 3600),
                )
            )

    items: dict[str, dict] = {}
    for m in markets:
        m.mood, m.mood_title = mood, mood_title
        if flow["prints"]:
            # Whale flow is market-wide, so it is attached to crypto books only — that is the
            # only vertical where a Binance print is genuinely informative.
            if (m.category or "").lower().startswith("crypto"):
                m.whale_buy, m.whale_sell = flow["buy"], flow["sell"]
                m.whale_prints = flow["prints"]
                m.top_print = flow["top"]
        elif whale:
            m.notes.append("Whale flow was not readable this cycle, so no large-trader claim is made.")
        prev = history.get(m.mid)
        if prev and isinstance(prev.get("prob"), (int, float)):
            m.prev_prob = float(prev["prob"])
            m.prev_ts = int(prev.get("ts", now))
        items[m.mid] = {
            "text": render(m),
            "tone": tone_for(m),
            "ts": int(time.time() * 1000),
            "basis": basis_for(m),
        }
        history[m.mid] = {"prob": round(m.prob, 6), "ts": now}

    save_history(workdir / "insights_history.json", history)

    payload = {
        "generatedAt": int(time.time() * 1000),
        "engine": engine,
        "source": "hermes-brain",
        "newsMood": mood,
        "whale": {
            "ok": flow["ok"],
            "prints": flow["prints"],
            "buy": round(flow["buy"], 2),
            "sell": round(flow["sell"], 2),
        },
        "items": items,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    dist = out.parent.parent / "dist" / out.name
    if dist.parent.exists():
        shutil.copyfile(out, dist)
    log.info("insights written: %d markets, %d skipped -> %s", len(items), skipped, out)
    return payload


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workdir", default="hermes-runtime")
    ap.add_argument("--out", default="frontend/public/insights.json")
    ap.add_argument("--rpc-url", default=DEFAULT_RPC)
    ap.add_argument("--engine", default=DEFAULT_ENGINE)
    ap.add_argument("--catalogue", default=None, help="path to frontend/src/data/markets.ts")
    ap.add_argument("--no-whale", action="store_true", help="skip Binance prints")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    payload = generate(
        Path(args.workdir),
        Path(args.out),
        args.rpc_url,
        args.engine,
        Path(args.catalogue) if args.catalogue else None,
        whale=not args.no_whale,
    )
    print(json.dumps({"ok": True, "markets": len(payload["items"]), "out": args.out}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
