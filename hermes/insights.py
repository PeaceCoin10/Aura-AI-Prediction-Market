#!/usr/bin/env python3
"""
Hermes AI brain -- market commentary generator.

Small but honest job: read the brain's own state (the markets it created) plus live on-chain
pools, blend in headline sentiment, and write one sharp / dry / geeky line per market into
`frontend/public/insights.json` (also copied to dist so a static host can serve it).

No invented data: every number comes from on-chain `marketCore`; news sentiment is a keyword
count only, so the commentary never asserts a specific event that was not verified. If the chain
read fails for a market, that market is skipped.

Usage:
    python3 hermes/insights.py                     # default RPC / state
    python3 hermes/insights.py --workdir hermes-runtime --out frontend/public/insights.json
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hermes_brain import Chain, ChainError, State  # noqa: E402
from verticals import NewsFeed  # noqa: E402

log = logging.getLogger("insights")

DEFAULT_RPC = "https://mainnet.base.org"
DEFAULT_ENGINE = "0xE6056Bc6700F6d7E6fF8779B212655284dc1631C"

BULL_WORDS = ("surge", "rally", "record", "beat", "approval", "etf", "adopt", "bull", "soar", "gain", "win")
BEAR_WORDS = ("crash", "hack", "ban", "lawsuit", "probe", "plunge", "slump", "fear", "warn", "bear", "loss", "fail")


def tone_for(prob: float, impact_bps: int, mood: int) -> str:
    if impact_bps >= 400:
        return "warn"
    if prob >= 0.75:
        return "warn"
    if prob <= 0.25:
        return "bear"
    if mood <= -2:
        return "bear"
    if mood >= 2:
        return "bull"
    if 0.45 <= prob <= 0.55:
        return "geek"
    return "bull" if prob > 0.55 else "bear"


def news_mood(news: NewsFeed, limit: int = 12) -> tuple[int, str]:
    """Rough sentiment: net bull/bear keyword hits across headlines. Returns (score, sample title)."""
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


def build_line(question: str, category: str, prob: float, depth: float, volume: float,
               hours_left: float, mood: int, mood_title: str) -> tuple[str, str]:
    """Return (commentary text, basis)."""
    pct = prob * 100
    if prob >= 0.78:
        text = (f"YES is already at {pct:.1f}% -- the crowd has priced the answer in. Chasing YES "
                f"here buys a thin edge at a thinner price, unless you think a catalyst is still unpriced.")
    elif prob >= 0.6:
        text = (f"Bulls lead at YES {pct:.1f}%, but only by a length: {category} has not produced a "
                f"decisive consensus yet, so scale in rather than going all at once.")
    elif prob >= 0.4:
        text = (f"Probability is parked in the neutral band at {pct:.1f}% while both sides wait for the "
                f"same new information -- the easiest seat here is market making, the worst is chasing.")
    elif prob >= 0.22:
        text = (f"Bears lead modestly at YES {pct:.1f}%: this is the 'cheap but needs a catalyst' shape, "
                f"where a small reversal bet is priced fairly and a large one just feeds the other side.")
    else:
        text = (f"YES is down to {pct:.1f}% and the market has mostly settled the question; without a "
                f"black-swan style {category} reversal the residual upside is not worth the carry.")

    if depth and depth < 500:
        text += f" The pool holds only {depth:.0f} USDC, so one sizeable order can move the price."
    if volume and depth and volume > depth * 2:
        text += f" Volume is already {volume / depth:.1f}x pool depth -- heavy turnover."
    if 0 < hours_left <= 2:
        text += f" {hours_left:.1f}h to settlement; the closing stretch is where wicks get printed."
    if mood >= 2:
        text += " Headlines lean warm (" + (mood_title[:40] or "net bullish keywords") + ")."
    elif mood <= -2:
        text += " Headlines lean cold (" + (mood_title[:40] or "net bearish keywords") + ")."

    basis = f"YES {pct:.1f}% - depth {depth:.0f} - volume {volume:.0f} - mood {mood:+d}"
    return text, basis


def generate(workdir: Path, out: Path, rpc: str, engine: str) -> dict:
    state = State.load(workdir / "hermes_state.json")
    chain = Chain(rpc, engine, None, dry_run=True)
    news = NewsFeed()
    mood, mood_title = news_mood(news)
    now = int(time.time())

    items: dict[str, dict] = {}
    skipped = 0
    for mid, rec in state.markets.items():
        if rec.resolved:
            continue
        try:
            core = chain.core(mid)
            prob = chain.price_yes(mid)  # 0..1
        except (ChainError, ValueError) as exc:
            skipped += 1
            log.warning("skip %s: %s", mid[:10], exc)
            continue
        depth = (core["yes_reserve"] + core["no_reserve"]) / 1e6
        volume = core["volume"] / 1e6
        hours_left = max(0.0, (core["resolution_time"] - now) / 3600)
        text, basis = build_line(
            rec.question, rec.vertical or rec.category, prob, depth, volume, hours_left, mood, mood_title
        )
        items[mid] = {
            "text": text,
            "tone": tone_for(prob, 0, mood),
            "ts": int(time.time() * 1000),
            "basis": basis,
        }

    payload = {
        "generatedAt": int(time.time() * 1000),
        "engine": engine,
        "source": "hermes-brain",
        "newsMood": mood,
        "items": items,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    # Keep a copy in dist too: the static server reads straight from there.
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
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    payload = generate(Path(args.workdir), Path(args.out), args.rpc_url, args.engine)
    print(json.dumps({"ok": True, "markets": len(payload["items"]), "out": args.out}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
