#!/usr/bin/env python3
"""Aura · cross-device cloud-sync end-to-end suite.

Proves the promise in the README with two isolated browser contexts (= two devices):

    1. device A connects (fixed signer injected), claims the 10,000 FAKE-USDC bonus and buys a
       position; the header chip must reach `synced` after a real round-trip.
    2. device B is a *fresh* profile with empty localStorage. It must adopt A's balance and
       position from the cloud without ever being told about them in the URL.
    3. the server-side record must be ciphertext: the raw store file cannot contain the balance.

Requirements: the reference sync server on :8787 and a build served with
`VITE_SYNC_ENDPOINT=http://127.0.0.1:8787/v1/blob`.

Usage:  python3 scripts/e2e_sync.py [base_url]
Exit code 0 only when every assertion passes.
"""
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4188/").rstrip("/") + "/"
STORE = Path(os.environ.get("SYNC_DATA_DIR", str(Path(__file__).resolve().parents[2] / ".sync-store")))
RELAY_MODE = os.environ.get("SYNC_MODE") == "relay"

PASS = 0
FAIL = 0
FAILED = []


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        FAILED.append(name)
        print(f"  FAIL {name} {detail}")


ADDRESS = "0x" + hashlib.sha256(str(time.time()).encode()).hexdigest()[:40]
SIGNATURE = "0x" + ("9c" * 65)
HOOK = {"address": ADDRESS, "signature": SIGNATURE}


def paper(page):
    raw = page.evaluate("() => localStorage.getItem('aura.paper.v1')")
    return json.loads(raw) if raw else {}


def relay_payload(tag):
    """Reassemble the newest complete chunk group from the public relay."""
    url = f"https://ntfy.sh/aura-sync-v1-{tag}/json?poll=1&since=all"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 aura-e2e"})
    try:
        with opener.open(req, timeout=30) as r:
            raw = r.read().decode()
    except Exception:
        return ""
    groups = {}
    totals = {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue
        text = msg.get("message") or ""
        if not text.startswith("AURA1|"):
            continue
        parts = text.split("|", 4)
        if len(parts) != 5:
            continue
        _, gid, idx, total, data = parts
        groups.setdefault(gid, {})[int(idx)] = data
        totals[gid] = int(total)
    for gid in sorted(groups, reverse=True):
        if len(groups[gid]) != totals.get(gid):
            continue
        return "".join(groups[gid][i] for i in range(totals[gid]))
    return ""


def wait_synced(page, timeout=25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        phase = page.locator('[data-testid="sync-badge"] button').first.get_attribute("data-phase")
        if phase == "synced":
            return True
        page.wait_for_timeout(1000)
    return False


def onboarding(page):
    """Dismiss the risk gate and both welcome stages, then wait for the hall to be clickable."""
    if page.get_by_role("button", name=re.compile("I understand the risk", re.I)).count():
        page.get_by_role("button", name=re.compile("I understand the risk", re.I)).first.click()
        page.wait_for_timeout(600)

    # Stage 0: the 10,000 FAKE-USDC counter animates for ~1.4s before its CTA is usable.
    page.wait_for_timeout(1500)
    cta = page.locator('[data-testid="airdrop-cta"]')
    if cta.count():
        cta.first.click()
        page.wait_for_timeout(700)
    pool = page.locator('[data-testid="pool-cta"]')
    if pool.count():
        pool.first.click()
        page.wait_for_timeout(700)

    # Nothing may sit over the hall when we start clicking cards.
    deadline = time.time() + 10
    while time.time() < deadline:
        if page.locator("div.fixed.inset-0.z-\\[68\\]").count() == 0:
            return
        page.wait_for_timeout(300)


def main():
    from playwright.sync_api import sync_playwright

    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--no-sandbox"])

        print("\n[1] device A · connect, trade, push")
        a = browser.new_context(viewport={"width": 1440, "height": 1100}, locale="en-US")
        a.add_init_script(f"window.__AURA_SYNC_TEST__ = {json.dumps(HOOK)};")
        pa = a.new_page()
        pa.on("pageerror", lambda e: errors.append(str(e)))
        pa.goto(BASE, wait_until="domcontentloaded", timeout=60_000)
        pa.wait_for_timeout(1800)
        onboarding(pa)

        # Claim the 10,000 FAKE-USDC onboarding bonus, then take a paper position.
        pa.locator('[data-testid="demo-hall"] button').first.click()
        pa.wait_for_timeout(900)
        modal = pa.locator("div.fixed.inset-0.z-50").last
        amount = modal.get_by_placeholder("0.00").first
        amount.fill("250")
        pa.wait_for_timeout(250)
        modal.get_by_role("button", name="Buy YES", exact=True).first.click()
        pa.wait_for_timeout(1200)
        modal.get_by_role("button", name=re.compile(r"^Close$", re.I)).first.click()
        pa.wait_for_timeout(600)

        before = paper(pa)
        balance_a = before.get("balance")
        check("device A has a funded ledger", balance_a is not None and int(balance_a) < 10_000_000_000,
              f"balance={balance_a}")
        check("device A recorded a position", len(before.get("positions") or {}) >= 1,
              f"positions={len(before.get('positions') or {})}")
        check("device A reaches the synced phase", wait_synced(pa), "chip never turned synced")

        tag = hashlib.sha256(f"aura-sync-v1:{ADDRESS.lower()}".encode()).hexdigest()[:24]

        if RELAY_MODE:
            raw = relay_payload(tag)
            check("the relay topic carries this wallet's record", bool(raw), f"topic=aura-sync-v1-{tag}")
            check("the relayed record is ciphertext (no balance in clear)", str(balance_a) not in raw, raw[:160])
            check("the relayed record carries an AES-GCM iv + tag", '"iv"' in raw and '"ct"' in raw)
            check("the relayed record holds no question text", "Will" not in raw)
        else:
            check("the cloud record exists for this wallet tag", (STORE / f"{tag}.json").exists(),
                  str(STORE / f"{tag}.json"))
            if (STORE / f"{tag}.json").exists():
                raw = (STORE / f"{tag}.json").read_text()
                check("the stored record is ciphertext (no balance in clear)", str(balance_a) not in raw, raw[:160])
                check("the stored record carries an AES-GCM iv + tag", '"iv"' in raw and '"ct"' in raw)
                check("the stored record holds no question text", "Will" not in raw)

        print("\n[2] device B · fresh profile, pull only")
        b = browser.new_context(viewport={"width": 1440, "height": 1100}, locale="en-US")
        b.add_init_script(f"window.__AURA_SYNC_TEST__ = {json.dumps(HOOK)};")
        pb = b.new_page()
        pb.on("pageerror", lambda e: errors.append(str(e)))
        pb.goto(BASE, wait_until="domcontentloaded", timeout=60_000)
        pb.wait_for_timeout(1800)
        check("device B starts without positions",
              len(paper(pb).get("positions") or {}) == 0, f"positions={len(paper(pb).get('positions') or {})}")
        onboarding(pb)

        check("device B reaches the synced phase", wait_synced(pb))
        after = paper(pb)
        check("device B adopts the cloud balance", after.get("balance") == balance_a, f"{after.get('balance')} vs {balance_a}")
        check("device B adopts the cloud position", len(after.get("positions") or {}) >= 1,
              f"positions={len(after.get('positions') or {})}")
        pb.wait_for_timeout(500)
        pb.locator("header").get_by_role("button", name=re.compile("^Portfolio$")).first.click()
        pb.wait_for_timeout(900)
        body = pb.inner_text("body")
        check("device B renders the restored position in the UI", "Paper" in body and "No positions yet" not in body,
              body[:120])

        print("\n[3] console health")
        real = [e for e in errors if "favicon" not in e.lower() and "Failed to load resource" not in e]
        check("no uncaught page errors in either device", len(real) == 0, str(real[:3]))

        a.close()
        b.close()
        browser.close()

    print(f"\nRESULT: {'ALL PASS' if FAIL == 0 else 'FAILURES'} ({PASS}/{PASS + FAIL})")
    for f in FAILED:
        print(f"  - {f}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
