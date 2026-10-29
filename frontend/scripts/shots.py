#!/usr/bin/env python3
"""Capture the acceptance screenshots: risk disclosure, welcome bonus, hall, detail, mobile.

Usage: python3 frontend/scripts/shots.py [url] [outdir]
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "reports/shots")
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1440, "height": 1100}, locale="en-US")
    pg = ctx.new_page()
    pg.goto(URL, wait_until="networkidle", timeout=90_000)
    pg.wait_for_timeout(1200)
    pg.screenshot(path=str(OUT / "01-risk-modal.png"))

    pg.get_by_role("button", name="I understand the risk — enter markets").click()
    pg.wait_for_timeout(1900)
    pg.screenshot(path=str(OUT / "02-welcome-airdrop.png"))

    pg.locator('[data-testid="airdrop-cta"]').click()
    pg.wait_for_timeout(900)
    pg.screenshot(path=str(OUT / "02b-novice-pool.png"))
    if pg.locator('[data-testid="pool-cta"]').count():
        pg.locator('[data-testid="pool-cta"]').click()
    pg.wait_for_timeout(1200)
    pg.screenshot(path=str(OUT / "03-hall-paper.png"))
    # full-page capture is limited to one vertical: 130 stacked cards exceed Playwright's canvas limit
    pg.locator('[data-testid="category-nav"]').get_by_role("button", name="Sports").first.click()
    pg.wait_for_timeout(700)
    pg.screenshot(path=str(OUT / "04-hall-sports.png"), full_page=True)
    pg.locator('[data-testid="category-nav"]').get_by_role("button", name="Trending").first.click()
    pg.wait_for_timeout(600)

    pg.locator('[data-testid="demo-hall"] button').first.click()
    pg.wait_for_timeout(1400)
    pg.screenshot(path=str(OUT / "05-demo-detail.png"))
    ctx.close()

    mob = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                        device_scale_factor=2, locale="en-US").new_page()
    mob.goto(URL, wait_until="networkidle", timeout=90_000)
    mob.wait_for_timeout(1200)
    if mob.get_by_role("button", name="I understand the risk — enter markets").count():
        mob.get_by_role("button", name="I understand the risk — enter markets").click()
        mob.wait_for_timeout(1500)
    if mob.locator('[data-testid="airdrop-cta"]').count():
        mob.locator('[data-testid="airdrop-cta"]').click()
        mob.wait_for_timeout(700)
    if mob.locator('[data-testid="pool-cta"]').count():
        mob.locator('[data-testid="pool-cta"]').click()
        mob.wait_for_timeout(700)
    mob.screenshot(path=str(OUT / "06-mobile-home.png"))
    b.close()

print(f"saved to {OUT.resolve()}")
