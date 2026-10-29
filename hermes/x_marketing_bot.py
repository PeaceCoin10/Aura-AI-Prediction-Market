#!/usr/bin/env python3
"""Aura X (Twitter) marketing bot.

Picks the hottest markets from the product catalogue, writes a punchy post with
the live probability, renders a 1200x675 SVG poster in the same visual language
as the dApp, and queues the result as JSONL. Posting to X happens only when
credentials are present:

    X_BEARER_TOKEN        app-only read access (sanity checks)
    X_USER_ACCESS_TOKEN   OAuth 2.0 user token with tweet.write scope

Without credentials the bot is a *dry* renderer: it fills ``outbox/`` and prints
the queue so a human can post. It never pretends a tweet went out.

Usage:
    python3 hermes/x_marketing_bot.py --limit 3          # queue + render only
    python3 hermes/x_marketing_bot.py --post             # also publish what it queued
    python3 hermes/x_marketing_bot.py --loop 3600 --limit 1
"""
from __future__ import annotations

import argparse
import http.client
import json
import os
import re
import textwrap
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "frontend" / "src" / "data" / "markets.ts"
OUTBOX = Path(__file__).resolve().parent / "outbox"
SITE = "https://peacecoin10.github.io/Aura-AI-Prediction-Market/"
HASHTAGS = "#PredictionMarkets #Base #AI #Crypto"

PALETTE = {
    "crypto": ("#f59e0b", "#7c2d12"),
    "news": ("#38bdf8", "#0c4a6e"),
    "sports": ("#34d399", "#064e3b"),
    "esports": ("#e879f9", "#4a044e"),
    "tech": ("#a78bfa", "#2e1065"),
}


@dataclass
class Market:
    id: str
    vertical: str
    question: str
    prob: int
    volume: int
    hours: int

    @property
    def hotness(self) -> float:
        """Volume per hour left: busy markets with little time left rank first."""
        return self.volume / max(self.hours, 1)

    @property
    def links(self) -> str:
        return f"{SITE} {HASHTAGS}"


# A catalogue row is a tuple literal:
#   ["id", "vertical", "question", "criteria", "source", prob, depthUsdc, hours, volumeUsdc, "topic"]
QUOTED = re.compile(r'"((?:[^"\\]|\\.)*)"')
NUMBERS = re.compile(r'(?<![\w."])([0-9]+(?:\.[0-9]+)?)(?![\w"])')
ROW_START = re.compile(r'^\s*\["')


def parse_catalogue(path: Path = CATALOGUE) -> list[Market]:
    """Read the TS catalogue without a build step.

    The file holds one tuple per market, so the fields are positional: the six quoted strings are
    id, vertical, question, criteria, source and topic; the four bare numbers are probability,
    pool depth, hours to resolution and traded volume.
    """
    markets: list[Market] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not ROW_START.match(line):
            continue
        strings = QUOTED.findall(line)
        if len(strings) < 3:
            continue
        mid, vertical, question = strings[0], strings[1], strings[2]

        # numbers live outside the quoted strings; strip them so digits inside a question cannot leak in
        bare = QUOTED.sub('""', line)
        numbers = NUMBERS.findall(bare)
        if len(numbers) < 4:
            continue
        prob = float(numbers[0])
        hours = int(float(numbers[2].replace("_", "")))
        volume = int(float(numbers[3].replace("_", "")))

        markets.append(
            Market(
                id=mid,
                vertical=vertical,
                question=question.replace('\\"', '"'),
                prob=int(round(prob * 100)),
                volume=volume,
                hours=hours,
            )
        )
    return markets


def tweet_text(m: Market) -> str:
    """Keep it under 280 characters, lead with the number, end with the link."""
    head = f"{m.prob}% on Aura: {m.question}"
    tail = f"\n\n{m.volume:,} USDC traded - settles in {m.hours}h\n{m.links}"
    budget = 280 - len(tail) - 1
    if len(head) > budget:
        head = head[: budget - 1].rstrip() + "..."
    return head + tail


def _esc(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def poster_svg(m: Market) -> str:
    """Deterministic share poster: vertical palette, big probability, progress bar."""
    accent, deep = PALETTE.get(m.vertical, ("#6ee7b7", "#064e3b"))
    lines = textwrap.wrap(m.question, width=38)[:5]
    question = "".join(
        '<text x="80" y="%d" font-size="44" fill="#e2e8f0" font-family="Inter,Segoe UI,sans-serif">%s</text>'
        % (250 + i * 58, _esc(line))
        for i, line in enumerate(lines)
    )
    grid = "".join(
        '<line x1="%d" y1="0" x2="%d" y2="675"/>' % (x, x) for x in range(0, 1200, 60)
    )
    bar = max(4, min(96, m.prob))
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">'
        '<defs>'
        '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="#05060a"/><stop offset="1" stop-color="{deep}"/>'
        "</linearGradient>"
        '<linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">'
        f'<stop offset="0" stop-color="{accent}"/><stop offset="1" stop-color="#6ee7b7"/>'
        "</linearGradient></defs>"
        '<rect width="1200" height="675" fill="url(#bg)"/>'
        f'<g opacity="0.14" stroke="{accent}" stroke-width="1">{grid}</g>'
        f'<text x="80" y="120" font-size="22" letter-spacing="6" fill="{accent}" '
        f'font-family="Inter,Segoe UI,sans-serif">AURA / {m.vertical.upper()}</text>'
        f'<text x="80" y="190" font-size="96" font-weight="700" fill="#f8fafc" '
        f'font-family="Inter,Segoe UI,sans-serif">{m.prob}%</text>'
        f"{question}"
        '<rect x="80" y="560" width="1040" height="14" rx="7" fill="#1e293b"/>'
        f'<rect x="80" y="560" width="{bar * 10.4:.0f}" height="14" rx="7" fill="url(#bar)"/>'
        f'<text x="80" y="625" font-size="22" fill="#94a3b8" '
        f'font-family="Inter,Segoe UI,sans-serif">{m.volume:,} USDC traded - settles in {m.hours}h</text>'
        '<text x="1120" y="625" text-anchor="end" font-size="22" fill="#6ee7b7" '
        'font-family="Inter,Segoe UI,sans-serif">aura / base</text>'
        "</svg>"
    )


def queue(markets: list[Market]) -> list[dict]:
    OUTBOX.mkdir(exist_ok=True)
    rows: list[dict] = []
    for m in markets:
        poster = OUTBOX / f"poster-{m.id}.svg"
        poster.write_text(poster_svg(m), encoding="utf-8")
        rows.append(
            {
                "id": m.id,
                "vertical": m.vertical,
                "prob": m.prob,
                "text": tweet_text(m),
                "poster": str(poster),
                "queued_at": int(time.time()),
                "posted": False,
            }
        )
    with (OUTBOX / "x_queue.jsonl").open("a", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    return rows


def post_tweet(text: str) -> dict:
    """POST /2/tweets with an OAuth 2.0 user token (tweet.write scope)."""
    token = os.environ.get("X_USER_ACCESS_TOKEN")
    if not token:
        return {"skipped": "X_USER_ACCESS_TOKEN not set"}
    conn = http.client.HTTPSConnection("api.x.com", timeout=30)
    payload = json.dumps({"text": text})
    conn.request(
        "POST",
        "/2/tweets",
        payload,
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    res = conn.getresponse()
    body = res.read().decode("utf-8", "replace")
    conn.close()
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        parsed = {"raw": body}
    return {"status": res.status, "body": parsed}


def pick(limit: int, catalogue: Path = CATALOGUE) -> list[Market]:
    markets = parse_catalogue(catalogue)
    if not markets:
        raise SystemExit(f"no markets parsed from {catalogue}")
    return sorted(markets, key=lambda m: m.hotness, reverse=True)[:limit]


def main() -> int:
    ap = argparse.ArgumentParser(description="Aura X marketing bot")
    ap.add_argument("--limit", type=int, default=3)
    ap.add_argument("--post", action="store_true", help="publish queued posts when credentials exist")
    ap.add_argument("--loop", type=int, default=0, help="run every N seconds (0 = once)")
    args = ap.parse_args()

    while True:
        markets = pick(args.limit)
        rows = queue(markets)
        for row in rows:
            print(f"[queue] {row['prob']:>3}%  {row['id']:<24} {len(row['text'])} chars")
            if args.post:
                print(f"[post ] {json.dumps(post_tweet(row['text']))[:180]}")
        if not args.post:
            print("[dry]  no credentials used - posters in hermes/outbox, tweets queued only")
        if args.loop <= 0:
            return 0
        time.sleep(args.loop)


if __name__ == "__main__":
    raise SystemExit(main())
