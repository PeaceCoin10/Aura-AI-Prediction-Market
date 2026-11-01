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



# --------------------------------------------------------------------------------------
# DeepSeek layer: the model writes the prose, the numbers come from here
# --------------------------------------------------------------------------------------

LLM_MODEL = "deepseek-chat"
LLM_BATCH = 6
TONE_ENUM = ("bull", "bear", "warn", "geek", "calm")

SYSTEM_PROMPT = (
    "You are the research desk of a binary prediction market. For each market you receive the "
    "question, the live probability, its change since the previous snapshot, pool depth, traded "
    "volume, whale prints from Binance spot, and the tone of current headlines.\n\n"
    "Write ONE paragraph per market, 60-110 words, plain prose, no bullet points, no headings, "
    "no preamble. Be specific and dry: a good sell-side note, not marketing copy.\n\n"
    "Hard rules:\n"
    "1. Cite the YES probability exactly as given (one decimal, e.g. 'YES 42.0%'). Never invent a "
    "probability, a price, a volume, a date or a statistic that is not in the input, and do not "
    "derive new numbers (no cost-to-reprice, no ratios, no multiples like '3x depth', no "
    "annualised figures): quote only values from the market's quotable_numbers list.\n"
    "2. If the headlines describe an exploit, hack, lawsuit, ban or macro shock, treat it as a "
    "risk channel: say explicitly how it would reprice this book. If the market's probability "
    "stands high despite that risk, name the divergence instead of pretending it does not exist. "
    "Never claim the market has already priced something the numbers do not show.\n"
    "3. If there are no whale prints, say there is no large-trader read; do not invent flow.\n"
    "4. Reason about the actual settlement rule of the market: what has to be true, and by when.\n"
    "4b. Whale discipline: if prints_over_25k is greater than zero, describe that flow using the "
    "given buy/sell figures; if it is zero, say there is no large-trader read. Never state the "
    "opposite of the field you were given.\n"
    "4c. No cross-market comparisons. Never call a book the deepest, most active, largest or "
    "shortest on the board unless the input explicitly says so.\n"
    "5. No advice to buy or sell, no promises of returns, no 'as an AI'.\n\n"
    'Return strict JSON: {"items":[{"id":"<market id>","text":"<paragraph>","tone":"bull|bear|warn|geek|calm"}]} '
    "with exactly one entry per market supplied, in the same order."
)


def _num_variants(x: float) -> set[str]:
    """Accepted spellings of one measured value: 182400 / 182,400 / 182.4k / 0.18m."""
    out: set[str] = set()
    for dp in (0, 1, 2):
        s = f"{x:,.{dp}f}"
        out.add(s)
        out.add(s.replace(",", ""))
    if abs(x) >= 1_000:
        for dp in (1, 2):
            s = f"{x / 1_000:,.{dp}f}"
            out.add(s)
            out.add(s.replace(",", ""))
    if abs(x) >= 1_000_000:
        out.add(f"{x / 1_000_000:.2f}")
        out.add(f"{x / 1_000_000:.1f}")
    return out


def allowed_numbers(m: Market, headlines: list[str]) -> set[str]:
    """Every number the model is allowed to quote: measured inputs plus constants of the protocol."""
    vals = [
        m.prob * 100,
        m.depth,
        m.volume,
        m.whale_buy,
        m.whale_sell,
        abs(m.whale_buy - m.whale_sell),
        m.whale_prints,
        m.hours_left,
        m.hours_left / 24,
        m.depth * IMPACT_CAP_BPS / 10_000,
        m.mood,
    ]
    if m.prev_prob is not None:
        vals += [m.prev_prob * 100, abs(m.prob - m.prev_prob) * 100]
    vals.append(min(95.0, m.prob * 100 + 10))  # the repricing target quoted in the computed text
    if m.depth > 0 and 0 < m.prob < 0.95:
        try:
            vals.append(impact_cost(m.depth, m.prob, min(0.95, m.prob + 0.1)))
        except ValueError:
            pass
    out: set[str] = set()
    for v in vals:
        out |= _num_variants(float(v))
    out |= {"1.5", "0.5", "5", "25", "25000", "25,000", "100"}
    for src in [m.question, *(headlines or [])]:
        for tok in re.findall(r"\d[\d,\.]*", src or ""):
            out.add(tok)
            out.add(tok.replace(",", "").rstrip("."))
    out |= {str(y) for y in range(2026, 2032)}
    return out


def quotable(m: Market) -> list[str]:
    """The exact figures the prose may quote for this market — nothing else is allowed through."""
    vals = [f"{m.prob * 100:.1f}%"]
    for v in (m.depth, m.volume):
        vals.append(f"{v:,.0f}")
    if m.whale_prints:
        vals += [f"{m.whale_buy:,.0f}", f"{m.whale_sell:,.0f}", f"{abs(m.whale_buy - m.whale_sell):,.0f}",
                 f"{m.whale_prints}"]
    if m.prev_prob is not None:
        vals.append(f"{abs(m.prob - m.prev_prob) * 100:.1f}")
    if m.hours_left:
        vals.append(f"{m.hours_left:,.0f}")
    if m.depth > 0 and 0 < m.prob < 0.95:
        try:
            vals.append(f"{impact_cost(m.depth, m.prob, min(0.95, m.prob + 0.1)):,.0f}")
        except ValueError:
            pass
    return vals


def market_payload(m: Market) -> dict:
    return {
        "quotable_numbers": quotable(m),
        "id": m.mid,
        "question": m.question,
        "category": m.category,
        "prob_yes_pct": round(m.prob * 100, 1),
        "delta_pts_since_last_snapshot": None if m.prev_prob is None else round((m.prob - m.prev_prob) * 100, 1),
        "depth_usdc": round(m.depth),
        "volume_usdc": round(m.volume),
        "hours_to_settlement": round(m.hours_left, 1),
        "whale": {
            "prints_over_25k": m.whale_prints,
            "buy_usdc": round(m.whale_buy),
            "sell_usdc": round(m.whale_sell),
            "net_usdc": round(m.whale_buy - m.whale_sell),
            "largest": None if not m.top_print else {
                "symbol": m.top_print[0], "side": m.top_print[2], "notional_usdc": round(m.top_print[1]),
            },
        },
        "news": {"tone_score": m.mood, "headlines": [m.mood_title] if m.mood_title else []},
    }


def build_messages(batch: list[Market], context: dict) -> list[dict]:
    user = {
        "as_of_utc": context.get("as_of"),
        "chain": "Base 8453",
        "engine": context.get("engine"),
        "global_headlines": context.get("headlines", []),
        "markets": [market_payload(m) for m in batch],
    }
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
    ]


def _close_enough(tok: str, allowed: set[str]) -> bool:
    """Accept a rounded spelling of a measured value (182,400 quoted as 182.4k / 182400)."""
    try:
        val = float(tok.replace(",", ""))
    except ValueError:
        return False
    if abs(val) < 1000:
        return False
    for a in allowed:
        try:
            ref = float(a.replace(",", ""))
        except ValueError:
            continue
        if ref >= 1000 and abs(val - ref) / ref <= 0.02:
            return True
    return False


def validate_items(raw: str, batch: list[Market], headlines: list[str]) -> dict[str, dict]:
    """Parse and police the model output. Anything that fails is dropped, never patched up."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"model did not return JSON: {exc}") from exc
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise ValueError("model JSON has no items array")

    by_id = {m.mid: m for m in batch}
    out: dict[str, dict] = {}
    for row in items:
        if not isinstance(row, dict):
            continue
        mid = row.get("id")
        text = (row.get("text") or "").strip()
        tone = (row.get("tone") or "").strip().lower()
        m = by_id.get(mid) if isinstance(mid, str) else None
        if m is None or not text:
            continue
        if not (45 <= len(text) <= 900):
            log.warning("drop %s: length %d out of bounds", mid, len(text))
            continue
        lowered = text.lower()
        if "as an ai" in lowered or "i cannot" in lowered:
            log.warning("drop %s: refusal language", mid)
            continue
        prob_txt = f"{m.prob * 100:.1f}%"
        if "yes" not in lowered or prob_txt not in text:
            log.warning("drop %s: missing the real probability %s", mid, prob_txt)
            continue
        allowed = allowed_numbers(m, headlines)
        bad = []
        for tok in re.findall(r"\d[\d,\.]*", text):
            clean = tok.rstrip(".,")
            if len(clean.replace(",", "").replace(".", "")) <= 1:
                continue  # single digits are ordinal/list noise, not claims
            plain = clean.replace(",", "")
            if clean in allowed or plain in allowed or _close_enough(plain, allowed):
                continue
            bad.append(tok)
        if bad:
            log.warning("drop %s: numbers not in the input: %s", mid, bad[:4])
            continue
        no_flow_claims = ("no whale", "zero print", "no large-trader", "no large trader", "no prints")
        if m.whale_prints > 0 and any(p in lowered for p in no_flow_claims):
            log.warning("drop %s: claims no flow while %d prints were supplied", mid, m.whale_prints)
            continue
        if m.whale_prints == 0 and ("net buy" in lowered or "net sell" in lowered):
            log.warning("drop %s: invents flow with zero prints", mid)
            continue
        superlatives = ("deepest", "most active", "largest book", "shortest horizon on the board")
        if any(p in lowered for p in superlatives) and "rank" not in lowered:
            log.warning("drop %s: unverified cross-market superlative", mid)
            continue
        out[mid] = {"text": text, "tone": tone if tone in TONE_ENUM else tone_for(m)}
    return out


REWRITE_PROMPT = (
    "Rewrite each market's paragraph so that it contains NO numerals other than the YES "
    "probability (one decimal) and, if present, a single volume or depth figure copied exactly "
    "as digits with commas. Remove every other number, ratio, multiple or derived figure. Keep "
    "the reasoning, the settlement rule and the risk read intact. Same JSON schema, same ids."
)


def _repair_messages(batch: list[Market], context: dict) -> list[dict]:
    msgs = build_messages(batch, context)
    msgs[0] = {"role": "system", "content": SYSTEM_PROMPT + "\n\n" + REWRITE_PROMPT}
    return msgs


def generate_llm(
    markets: list[Market],
    context: dict,
    chat_fn=None,
    batch_size: int = LLM_BATCH,
) -> dict[str, dict]:
    """Ask DeepSeek for commentary in batches. Raises DeepSeekError only if nothing came back."""
    if chat_fn is None:
        from deepseek import chat as chat_fn  # local import: keeps offline paths import-free

    headlines = context.get("headlines", [])
    out: dict[str, dict] = {}
    failures = 0
    for i in range(0, len(markets), batch_size):
        batch = markets[i:i + batch_size]
        try:
            raw = chat_fn(build_messages(batch, context), model=LLM_MODEL, temperature=0.35,
                          max_tokens=1400, json_mode=True)
            validated = validate_items(raw, batch, headlines)
            out.update(validated)
            missing = [m for m in batch if m.mid not in validated]
            if missing:
                # One repair pass: strip the offending figures instead of losing the market.
                try:
                    raw2 = chat_fn(_repair_messages(missing, context), model=LLM_MODEL,
                                   temperature=0.2, max_tokens=1200, json_mode=True)
                    out.update(validate_items(raw2, missing, headlines))
                except Exception as exc:  # noqa: BLE001
                    log.warning("llm repair failed: %s", exc)
        except Exception as exc:  # noqa: BLE001 - one bad batch must not kill the run
            failures += 1
            log.warning("llm batch %d failed: %s", i // batch_size, exc)
    if failures:
        log.warning("llm: %d/%d batches failed", failures, math.ceil(len(markets) / batch_size))
    return out


def generate(
    workdir: Path,
    out: Path,
    rpc: str,
    engine: str,
    catalogue: Path | None = None,
    whale: bool = True,
    llm: bool = False,
    chat_fn=None,
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

    # ---- DeepSeek pass: prose from the model, every number still from the inputs ----
    llm_items: dict[str, dict] = {}
    headlines = [mood_title] if mood_title else []
    if llm and markets:
        context = {
            "as_of": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
            "engine": engine,
            "headlines": headlines,
        }
        llm_items = generate_llm(markets, context, chat_fn=chat_fn)
        log.info("llm: %d/%d markets answered by %s", len(llm_items), len(markets), LLM_MODEL)

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
        written = llm_items.get(m.mid)
        items[m.mid] = {
            "text": written["text"] if written else render(m),
            "tone": written["tone"] if written else tone_for(m),
            "ts": int(time.time() * 1000),
            "basis": basis_for(m),
            "source": "deepseek" if written else "computed",
        }
        history[m.mid] = {"prob": round(m.prob, 6), "ts": now}

    save_history(workdir / "insights_history.json", history)

    payload = {
        "generatedAt": int(time.time() * 1000),
        "engine": engine,
        "source": "hermes-brain",
        "newsMood": mood,
        "llm": {"enabled": bool(llm), "model": LLM_MODEL, "answered": len(llm_items)},
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
    ap.add_argument("--llm", choices=("deepseek", "off"), default="deepseek",
                    help="write commentary with DeepSeek (needs DEEPSEEK_API_KEY); 'off' = computed only")
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
        llm=args.llm == "deepseek",
    )
    print(json.dumps({"ok": True, "markets": len(payload["items"]), "out": args.out}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
