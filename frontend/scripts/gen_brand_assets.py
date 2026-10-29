#!/usr/bin/env python3
"""Generate Aura brand assets (vector + raster) from one source of truth.

Outputs:
  frontend/public/favicon.svg          app favicon (browser tab)
  frontend/public/apple-touch-icon.png 512x512 home-screen icon
  frontend/public/og.png               1200x630 Open Graph / X card
  assets/logo.svg                      mark only, for README/GitHub
  assets/banner.svg / assets/banner.png 1280x400 repo banner

Run: python3 frontend/scripts/gen_brand_assets.py
Requires playwright chromium (already used by the e2e suite).
"""
import base64
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "frontend" / "public"
ASSETS = ROOT / "assets"
PUBLIC.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)

GRAD = """<linearGradient id="g" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#6ee7b7"/><stop offset="46%" stop-color="#34d399"/><stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>"""

# Mark: hexagonal matrix shield + oracle eye + three-node iris circuit (64x64 space)
MARK = """<g>
      <path d="M32 4.5 55.5 17.2v21.4c0 9.9-9.4 17.9-23.5 22.9C17.9 55.5 8.5 47.5 8.5 37.6V17.2L32 4.5Z"
            fill="rgba(52,211,153,0.07)" stroke="url(#g)" stroke-width="2" stroke-linejoin="round"/>
      <path d="M14.5 32.4c4.6-7.6 10.9-11.4 17.5-11.4s12.9 3.8 17.5 11.4c-4.6 7.6-10.9 11.4-17.5 11.4S19.1 40 14.5 32.4Z"
            fill="#05070c" stroke="url(#g)" stroke-width="1.6"/>
      <circle cx="32" cy="32.4" r="6.4" fill="url(#g)" opacity="0.92"/>
      <circle cx="32" cy="32.4" r="2.4" fill="#05070c"/>
      <g stroke="#34d399" stroke-width="1.1" opacity="0.85" stroke-linecap="round">
        <path d="M32 12v5"/><path d="M32 47.8v5"/>
        <path d="M11.6 32.4h5"/><path d="M47.4 32.4h5"/>
        <path d="M19 19.6l3.6 3.6"/><path d="M41.4 41.6l3.6 3.6"/>
        <path d="M45 19.6l-3.6 3.6"/><path d="M22.6 41.6l-3.6 3.6"/>
      </g>
      <circle cx="32" cy="12" r="1.4" fill="#6ee7b7"/>
      <circle cx="32" cy="52.8" r="1.4" fill="#22d3ee"/>
      <circle cx="11.6" cy="32.4" r="1.4" fill="#22d3ee"/>
      <circle cx="52.4" cy="32.4" r="1.4" fill="#6ee7b7"/>
    </g>"""


def svg_mark(size: int = 64) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 64 64" fill="none" role="img" aria-label="Aura AI prediction market logo">
  <defs>{GRAD}</defs>
  {MARK}
</svg>"""


BANNER = """<!doctype html><html><head><meta charset="utf-8"><style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  html,body{{width:{w}px;height:{h}px;overflow:hidden;background:#05060a}}
  body{{font-family:"Inter","Segoe UI",system-ui,-apple-system,sans-serif;color:#e6edf6}}
  .wrap{{position:relative;width:100%;height:100%;display:flex;align-items:center;gap:56px;padding:0 72px}}
  .glow{{position:absolute;inset:0;background:
     radial-gradient(60% 90% at 12% 20%,rgba(52,211,153,.22),transparent 60%),
     radial-gradient(50% 80% at 88% 80%,rgba(34,211,238,.14),transparent 65%),
     radial-gradient(40% 60% at 60% 0%,rgba(167,139,250,.10),transparent 70%)}}
  .grid{{position:absolute;inset:0;opacity:.5;
     background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
     background-size:48px 48px;mask-image:radial-gradient(120% 120% at 30% 30%,#000 30%,transparent 85%)}}
  .mark{{position:relative;width:{mark}px;height:{mark}px;flex:0 0 auto;filter:drop-shadow(0 0 34px rgba(52,211,153,.45))}}
  .copy{{position:relative;z-index:2;min-width:0}}
  .eyebrow{{font-size:{eyebrow}px;letter-spacing:.34em;text-transform:uppercase;color:#5eead4;opacity:.9}}
  .word{{font-size:{word}px;font-weight:700;letter-spacing:-.02em;line-height:1;margin-top:10px;
     background:linear-gradient(92deg,#eafff6 0%,#6ee7b7 38%,#34d399 62%,#22d3ee 100%);
     -webkit-background-clip:text;background-clip:text;color:transparent}}
  .tag{{margin-top:{tagmt}px;font-size:{tag}px;color:#93a3b8;letter-spacing:.01em}}
  .chips{{display:flex;gap:12px;margin-top:{chipmt}px}}
  .chip{{font-size:{chipfs}px;letter-spacing:.08em;text-transform:uppercase;color:#9fb3c8;
     border:1px solid rgba(52,211,153,.28);background:rgba(52,211,153,.07);border-radius:999px;padding:6px 14px}}
  .chip.on{{color:#05060a;background:linear-gradient(92deg,#6ee7b7,#34d399);border-color:transparent;font-weight:700}}
  .foot{{position:absolute;left:72px;right:72px;bottom:{footbottom}px;display:flex;align-items:center;justify-content:space-between;
     border-top:1px solid rgba(255,255,255,.07);padding-top:16px;font-size:{footfs}px;letter-spacing:.16em;text-transform:uppercase;color:#5b6b80}}
  .foot .k{{color:#8fa3b8}}
</style></head><body><div class="wrap">
  <div class="glow"></div><div class="grid"></div>
  <div class="mark">{mark_svg}</div>
  <div class="copy">
    <div class="eyebrow">Agentic DeFi · Base mainnet</div>
    <div class="word">AURA</div>
    <div class="tag">{tagline}</div>
    <div class="chips"><span class="chip on">Verified on Base</span><span class="chip">CPMM</span><span class="chip">AI agent</span><span class="chip">Paper trading</span></div>
  </div>
  <div class="foot"><span class="k">{footleft}</span><span>{footright}</span></div>
</div></body></html>"""


def mark_inline(px: int) -> str:
    # inline the mark so the rendered HTML is self-contained
    inner = svg_mark(64).split(">", 1)[1].rsplit("</svg>", 1)[0]
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{px}" height="{px}" viewBox="0 0 64 64" fill="none">{inner}</svg>'


def banner_svg(w: int, h: int) -> str:
    # Vector banner for GitHub (README <img>), same composition as the raster card.
    scale = w / 1280
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 1280 400" role="img" aria-label="Aura — agentic prediction markets on Base">
  <defs>
    {GRAD}
    <radialGradient id="glowA" cx="0.12" cy="0.2" r="0.6">
      <stop offset="0%" stop-color="#34d399" stop-opacity="0.22"/><stop offset="100%" stop-color="#34d399" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="0.88" cy="0.8" r="0.5">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.14"/><stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="word" x1="360" y1="120" x2="760" y2="220" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#eafff6"/><stop offset="38%" stop-color="#6ee7b7"/>
      <stop offset="62%" stop-color="#34d399"/><stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M48 0H0V48" fill="none" stroke="rgba(255,255,255,0.035)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="1280" height="400" fill="#05060a"/>
  <rect width="1280" height="400" fill="url(#grid)"/>
  <rect width="1280" height="400" fill="url(#glowA)"/>
  <rect width="1280" height="400" fill="url(#glowB)"/>
  <g transform="translate(96,{int((400 - 176) / 2)}) scale({176 / 64:.4f})">{MARK.replace('id="g"', 'id="g"')}</g>
  <text x="344" y="152" font-family="Inter, Segoe UI, sans-serif" font-size="20" letter-spacing="7" fill="#5eead4" opacity="0.9">AGENTIC DEFI · BASE MAINNET</text>
  <text x="340" y="248" font-family="Inter, Segoe UI, sans-serif" font-size="96" font-weight="700" fill="url(#word)" letter-spacing="-2">AURA</text>
  <text x="344" y="292" font-family="Inter, Segoe UI, sans-serif" font-size="22" fill="#93a3b8">AI-written prediction markets. CPMM pricing. On-chain settlement.</text>
  <g font-family="Inter, Segoe UI, sans-serif" font-size="15" letter-spacing="1">
    <rect x="344" y="316" width="150" height="34" rx="17" fill="#34d399"/>
    <text x="364" y="338" fill="#05060a" font-weight="700">VERIFIED ON BASE</text>
    <rect x="508" y="316" width="86" height="34" rx="17" fill="rgba(52,211,153,0.07)" stroke="rgba(52,211,153,0.28)"/>
    <text x="530" y="338" fill="#9fb3c8">CPMM</text>
    <rect x="608" y="316" width="112" height="34" rx="17" fill="rgba(52,211,153,0.07)" stroke="rgba(52,211,153,0.28)"/>
    <text x="630" y="338" fill="#9fb3c8">AI AGENT</text>
    <rect x="734" y="316" width="168" height="34" rx="17" fill="rgba(52,211,153,0.07)" stroke="rgba(52,211,153,0.28)"/>
    <text x="756" y="338" fill="#9fb3c8">PAPER TRADING</text>
  </g>
</svg>"""


def main() -> int:
    (ASSETS / "logo.svg").write_text(svg_mark(512), encoding="utf-8")
    (PUBLIC / "favicon.svg").write_text(svg_mark(64), encoding="utf-8")
    (ASSETS / "banner.svg").write_text(banner_svg(1280, 400), encoding="utf-8")

    from playwright.sync_api import sync_playwright

    def shoot(html: str, out: pathlib.Path, w: int, h: int, transparent: bool = False) -> None:
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True, args=["--no-sandbox"])
            pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
            pg.set_content(html, wait_until="load")
            pg.wait_for_timeout(400)
            pg.screenshot(path=str(out), omit_background=transparent)
            b.close()

    # OG / X card 1200x630
    og_html = BANNER.format(
        w=1200, h=630, mark=244, word=118, eyebrow=18, tag=21, tagmt=18, chipmt=26, chipfs=15,
        footbottom=48, footfs=13, mark_svg=mark_inline(244),
        tagline="AI-written markets · CPMM pricing · on-chain settlement",
        footleft="aura.markets", footright="Base 8453 · contracts verified",
    )
    shoot(og_html, PUBLIC / "og.png", 1200, 630)

    # GitHub banner 1280x400
    gb_html = BANNER.format(
        w=1280, h=400, mark=176, word=96, eyebrow=20, tag=21, tagmt=16, chipmt=22, chipfs=15,
        footbottom=26, footfs=12, mark_svg=mark_inline(176),
        tagline="AI-written prediction markets. CPMM pricing. On-chain settlement.",
        footleft="aura.markets", footright="Base 8453 · contracts verified",
    )
    shoot(gb_html, ASSETS / "banner.png", 1280, 400)

    # Apple touch icon 512x512 (mark on dark rounded square)
    icon_html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{{margin:0;width:512px;height:512px;background:#05060a}}
      .c{{width:512px;height:512px;display:flex;align-items:center;justify-content:center;
          background:radial-gradient(70% 70% at 30% 20%,rgba(52,211,153,.25),transparent 65%),#05060a}}
    </style></head><body><div class="c">{mark_inline(340)}</div></body></html>"""
    shoot(icon_html, PUBLIC / "apple-touch-icon.png", 512, 512)

    for p in (ASSETS / "logo.svg", ASSETS / "banner.svg", ASSETS / "banner.png", PUBLIC / "favicon.svg", PUBLIC / "og.png", PUBLIC / "apple-touch-icon.png"):
        print(f"{p.relative_to(ROOT)}  {p.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
