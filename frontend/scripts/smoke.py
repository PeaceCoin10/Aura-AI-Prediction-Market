#!/usr/bin/env python3
"""前端冒烟：加载 dev server，抓控制台错误 + 截图。"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5173/"

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, locale="zh-CN")
    pg = ctx.new_page()
    logs = []
    pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
    pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    failed = []
    pg.on("requestfailed", lambda r: failed.append(f"{r.url} :: {r.failure}"))
    pg.goto(URL, wait_until="networkidle", timeout=90_000)
    pg.wait_for_timeout(4000)
    pg.screenshot(path="/tmp/fe_home.png", full_page=True)
    body = pg.inner_text("body")
    print("TITLE:", pg.title())
    print("TEXT_LEN:", len(body))
    print("---- visible text (first 900) ----")
    print(body[:900])
    print("---- console ----")
    for l in logs[:25]:
        print(" ", l)
    print("---- failed requests ----")
    for f in failed[:10]:
        print(" ", f)
    b.close()
