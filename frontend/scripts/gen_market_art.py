#!/usr/bin/env python3
"""Generate the featured-market artwork library (one SVG per market + category banners).

Deterministic: the same market id always produces the same picture, so the art can be committed
and served as a static asset — no external image CDN, no rate limits, no broken cards offline.

    python3 frontend/scripts/gen_market_art.py

Output: frontend/public/art/<market-id>.svg, banner-<vertical>.svg, spotlight.svg
"""
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "public" / "art"
DATA = ROOT / "frontend" / "src" / "data" / "markets.ts"

# accent, accent-2, mid-tone, near-black base — one family per vertical
PAL = {
    "crypto": ("#f59e0b", "#fcd34d", "#7c2d12", "#0b0703"),
    "news": ("#38bdf8", "#bae6fd", "#0c4a6e", "#03080f"),
    "sports": ("#34d399", "#a7f3d0", "#065f46", "#030c09"),
    "esports": ("#e879f9", "#c4b5fd", "#4c1d95", "#0a0410"),
    "tech": ("#a78bfa", "#67e8f9", "#1e1b4b", "#05060f"),
}
NAMES = {
    "crypto": "CRYPTO · MACRO",
    "news": "GLOBAL POLITICS",
    "sports": "SPORTS · F1",
    "esports": "ESPORTS",
    "tech": "AI · TECH FRONTIERS",
}


def seed(text: str) -> int:
    return int(hashlib.sha256(text.encode()).hexdigest()[:8], 16)


def motif(v: str, s: int, w: int, h: int) -> str:
    rand = lambda n: (s >> (n * 3)) & 0xFFFF
    parts = []
    if v == "crypto":
        for i in range(9):
            x = 90 + i * 118 + rand(i) % 26
            bh = 70 + (rand(i + 1) % 210)
            y = h * 0.74 - bh
            col = "#34d399" if i % 3 else "#f87171"
            parts.append(f'<rect x="{x}" y="{y:.0f}" width="14" height="{bh}" rx="3" fill="{col}" opacity="{0.30 + (i % 4) * 0.08:.2f}"/>')
            parts.append(f'<line x1="{x + 7}" y1="{y - 26:.0f}" x2="{x + 7}" y2="{y + bh + 18:.0f}" stroke="{col}" stroke-width="2" opacity=".4"/>')
        pts = " ".join(f"{40 + i * 108},{int(h * 0.5 - (rand(i + 5) % 150))}" for i in range(11))
        parts.append(f'<polyline points="{pts}" fill="none" stroke="#fcd34d" stroke-width="3" opacity=".7"/>')
    elif v == "news":
        for i in range(9):
            y = 120 + i * 52
            parts.append(f'<path d="M60 {y} H{1140 - (rand(i) % 260)}" stroke="#bae6fd" stroke-width="2" opacity=".12"/>')
        parts.append(f'<circle cx="{w * 0.5:.0f}" cy="{h * 0.5:.0f}" r="210" fill="none" stroke="#38bdf8" stroke-width="1.6" opacity=".28"/>')
        for i in range(5):
            parts.append(f'<ellipse cx="{w * 0.5:.0f}" cy="{h * 0.5:.0f}" rx="210" ry="{60 + i * 40}" fill="none" stroke="#38bdf8" stroke-width="1" opacity=".18"/>')
        for i in range(6):
            cx, cy = 250 + (rand(i) % 700), 160 + (rand(i + 2) % 380)
            rr = 40 + (rand(i + 3) % 90)
            parts.append(f'<circle cx="{cx}" cy="{cy}" r="{rr}" fill="none" stroke="#38bdf8" stroke-width="1.5" opacity=".3"/>')
            parts.append(f'<circle cx="{cx}" cy="{cy}" r="4" fill="#bae6fd" opacity=".85"/>')
    elif v == "sports":
        parts.append(f'<rect x="70" y="90" width="{w - 140}" height="{h - 190}" rx="8" fill="none" stroke="#a7f3d0" stroke-width="2" opacity=".22"/>')
        parts.append(f'<line x1="{w / 2:.0f}" y1="90" x2="{w / 2:.0f}" y2="{h - 100}" stroke="#a7f3d0" stroke-width="2" opacity=".22"/>')
        parts.append(f'<circle cx="{w / 2:.0f}" cy="{h / 2 - 8:.0f}" r="120" fill="none" stroke="#a7f3d0" stroke-width="2" opacity=".22"/>')
        parts.append(f'<circle cx="{w / 2:.0f}" cy="{h / 2 - 8:.0f}" r="6" fill="#34d399" opacity=".85"/>')
        for i in range(7):
            cx, cy = 150 + (rand(i) % 900), 130 + (rand(i + 1) % 460)
            parts.append(f'<circle cx="{cx}" cy="{cy}" r="{3 + (i % 3)}" fill="#34d399" opacity=".55"/>')
            parts.append(f'<line x1="{cx}" y1="{cy}" x2="{cx + 90 + (rand(i) % 140)}" y2="{cy - 60 + (rand(i + 4) % 120)}" stroke="#34d399" stroke-width="1.2" opacity=".28"/>')
    elif v == "esports":
        for i in range(8):
            cx = 140 + i * 132
            parts.append(f'<polygon points="{cx},130 {cx + 54},160 {cx + 54},220 {cx},250 {cx - 54},220 {cx - 54},160" fill="none" stroke="#c4b5fd" stroke-width="1.6" opacity="{0.16 + (i % 3) * 0.09:.2f}"/>')
        parts.append(f'<circle cx="{w / 2:.0f}" cy="{h / 2:.0f}" r="180" fill="none" stroke="#e879f9" stroke-width="1.8" opacity=".3"/>')
        parts.append(f'<circle cx="{w / 2:.0f}" cy="{h / 2:.0f}" r="70" fill="none" stroke="#e879f9" stroke-width="1.8" opacity=".35"/>')
        parts.append(f'<path d="M{w / 2:.0f} {h / 2 - 200:.0f}v90M{w / 2:.0f} {h / 2 + 110:.0f}v90M{w / 2 - 200:.0f} {h / 2:.0f}h90M{w / 2 + 110:.0f} {h / 2:.0f}h90" stroke="#e879f9" stroke-width="2" opacity=".4"/>')
    else:
        parts.append('<g stroke="#a78bfa" stroke-width="1.3" opacity=".26" fill="none">')
        for i in range(7):
            y = 140 + i * 64
            parts.append(f'<path d="M90 {y} H420 L460 {y + 26} H{520 + i * 60}"/>')
            parts.append(f'<path d="M{520 + i * 70} {y + 26} V{560 - i * 20}"/>')
        parts.append("</g>")
        parts.append(f'<circle cx="{w / 2:.0f}" cy="{h / 2 - 10:.0f}" r="120" fill="none" stroke="#a78bfa" stroke-width="1.6" opacity=".3"/>')
        for i in range(12):
            cx, cy = 120 + (rand(i) % 960), 150 + (rand(i + 3) % 420)
            parts.append(f'<circle cx="{cx}" cy="{cy}" r="{3 + (i % 3)}" fill="#67e8f9" opacity=".55"/>')
    return "\n    ".join(parts)


def frame(v: str, s: int, w: int, h: int) -> str:
    c1, c2, mid, base = PAL[v]
    return f'''<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="{w}" y2="{h}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="{base}"/><stop offset="52%" stop-color="{mid}" stop-opacity=".30"/><stop offset="100%" stop-color="{base}"/>
    </linearGradient>
    <radialGradient id="glow" cx="{18 + s % 64}%" cy="{26 + (s >> 3) % 52}%" r="58%">
      <stop offset="0%" stop-color="{c1}" stop-opacity=".30"/><stop offset="100%" stop-color="{c1}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig" cx="50%" cy="50%" r="72%">
      <stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".62"/>
    </radialGradient>
    <linearGradient id="edge" x1="0" y1="{h}" x2="{w}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="{c1}" stop-opacity="0"/><stop offset="50%" stop-color="{c2}" stop-opacity=".7"/><stop offset="100%" stop-color="{c1}" stop-opacity="0"/>
    </linearGradient>
    <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
      <path d="M60 0H0V60" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
    </pattern>
    <clipPath id="c"><rect width="{w}" height="{h}"/></clipPath>
  </defs>
  <g clip-path="url(#c)">
    <rect width="{w}" height="{h}" fill="url(#bg)"/>
    <rect width="{w}" height="{h}" fill="url(#grid)"/>
    <rect width="{w}" height="{h}" fill="url(#glow)"/>
    {motif(v, s, w, h)}
    <rect width="{w}" height="{h}" fill="url(#vig)"/>
    <rect x="0" y="{h - 3}" width="{w}" height="3" fill="url(#edge)"/>
  </g>'''


def market_svg(mid: str, v: str, label: str, w=1200, h=675) -> str:
    s = seed(mid)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'role="img" aria-label="{label}">\n  {frame(v, s, w, h)}\n</svg>\n')


def banner_svg(v: str, n: int, w=1200, h=380) -> str:
    c1, c2, _mid, base = PAL[v]
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{NAMES[v]}">
  <defs>
    <linearGradient id="txt" x1="0" y1="0" x2="640" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff"/><stop offset="62%" stop-color="{c2}"/><stop offset="100%" stop-color="{c1}"/>
    </linearGradient>
  </defs>
  {frame(v, seed(v + "banner"), w, h)}
  <text x="72" y="198" font-family="Inter, Segoe UI, sans-serif" font-size="66" font-weight="700" fill="url(#txt)" letter-spacing="-1.5">{NAMES[v]}</text>
  <text x="74" y="246" font-family="Inter, Segoe UI, sans-serif" font-size="21" fill="#9fb3c8">{n} markets · CPMM pricing · simulated book</text>
  <rect x="72" y="278" width="152" height="36" rx="18" fill="{c1}"/>
  <text x="94" y="302" font-family="Inter, Segoe UI, sans-serif" font-size="15" font-weight="700" fill="#05060a">TRADE NOW</text>
</svg>
'''


def read_markets():
    text = DATA.read_text()
    rows = re.findall(r'^\s*\["([^"]+)",\s*"(\w+)",\s*"((?:[^"\\]|\\.)*)"', text, re.M)
    return [(mid, v, q.replace('\\"', '"')) for mid, v, q in rows]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = read_markets()
    if not rows:
        raise SystemExit("no markets parsed from " + str(DATA))
    per = {}
    for mid, v, q in rows:
        (OUT / f"{mid}.svg").write_text(market_svg(mid, v, q[:70]))
        per[v] = per.get(v, 0) + 1
    for v, n in per.items():
        (OUT / f"banner-{v}.svg").write_text(banner_svg(v, n))
    (OUT / "spotlight.svg").write_text(market_svg("spotlight-ai-desk", "tech", "Aura AI desk", 1600, 520))
    total = len(list(OUT.glob("*.svg")))
    print(f"markets={len(rows)} verticals={per} files={total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
