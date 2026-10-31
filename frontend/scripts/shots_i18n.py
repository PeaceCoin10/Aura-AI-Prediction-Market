#!/usr/bin/env python3
"""Capture the globalisation + cloud-sync surfaces for the README.

Usage: python3 frontend/scripts/shots_i18n.py [url] [outdir]
"""
import re
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
    pg.goto(URL, wait_until="domcontentloaded", timeout=90_000)
    pg.wait_for_timeout(2500)
    if pg.get_by_role("button", name=re.compile("I understand the risk", re.I)).count():
        pg.get_by_role("button", name=re.compile("I understand the risk", re.I)).first.click()
        pg.wait_for_timeout(1800)
    if pg.locator('[data-testid="airdrop-cta"]').count():
        pg.locator('[data-testid="airdrop-cta"]').first.click()
        pg.wait_for_timeout(800)
    if pg.locator('[data-testid="pool-cta"]').count():
        pg.locator('[data-testid="pool-cta"]').first.click()
        pg.wait_for_timeout(800)

    # 1) frosted language switcher, open
    pg.locator('[data-testid="locale-switcher"] button').first.click()
    pg.wait_for_timeout(500)
    pg.screenshot(path=str(OUT / "07-locale-switcher.png"), clip={"x": 700, "y": 0, "width": 740, "height": 300})

    # 2) the same hall in Simplified Chinese
    pg.locator('[data-locale="zh"]').click()
    pg.wait_for_timeout(700)
    pg.screenshot(path=str(OUT / "08-hall-zh.png"), full_page=False)

    # back to English, then the cloud-sync panel
    pg.locator('[data-testid="locale-switcher"] button').first.click()
    pg.wait_for_timeout(250)
    pg.locator('[data-locale="en"]').click()
    pg.wait_for_timeout(700)
    pg.locator('[data-testid="sync-badge"] button').first.click()
    pg.wait_for_timeout(500)
    pg.screenshot(path=str(OUT / "09-cloud-sync-panel.png"), clip={"x": 860, "y": 0, "width": 580, "height": 420})

    print("saved to", OUT)
    b.close()
