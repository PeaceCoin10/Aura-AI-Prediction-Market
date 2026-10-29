#!/usr/bin/env python3
"""
Drive the Basescan "Verify & Publish" wizard unattended with Playwright (no ETHERSCAN_API_KEY needed).

The Standard-Json-Input flow needs a real browser with JS (the server-side form is ASP.NET with a
JS upload), and a plain POST gets stuck on the upload postback, so we drive Chromium instead.

Usage:
  python3 deploy/basescan_pw_verify.py <address> <sjis.json> <ctor_args_hex> <label> [--headful]
"""
import json
import os
import re
import sys
from playwright.sync_api import sync_playwright

BASE = "https://basescan.org"
SOLC = "v0.8.24+commit.e11b9ed9"


def proxy_cfg():
    p = os.environ.get("https_proxy") or os.environ.get("http_proxy")
    if not p:
        return None
    p = p.replace("http://", "")
    host, _, port = p.partition(":")
    return {"server": f"http://{host}:{port}"}


def wait_turnstile(page, label, timeout=60):
    """Wait for Cloudflare Turnstile to produce a token; click a visible checkbox first if present. Returns whether the token has a value."""
    js = ("() => {const i=document.querySelector('input[name=\"cf-turnstile-response\"]');"
          "return i ? i.value : null;}")
    deadline = timeout
    clicked = False
    while deadline > 0:
        try:
            tok = page.evaluate(js)
        except Exception:
            tok = None
        if tok:
            return True
        if not clicked:
            for fr in page.frames:
                if "challenges.cloudflare.com" in (fr.url or ""):
                    try:
                        box = fr.locator("input[type=checkbox], body")
                        if box.count():
                            box.first.click(timeout=3000)
                            clicked = True
                            print(f"[{label}] clicked turnstile checkbox")
                    except Exception:
                        clicked = True
        page.wait_for_timeout(2000)
        deadline -= 2
    return False


def main():
    address, sjis_path, ctor, label = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    headful = "--headful" in sys.argv
    ctor = ctor.replace("0x", "", 1)
    out = {}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=not headful,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
            proxy=proxy_cfg(),
        )
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 1000},
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"),
            locale="en-US",
        )
        page = ctx.new_page()
        page.set_default_timeout(120000)

        print(f"[{label}] goto /verifyContract")
        page.goto(f"{BASE}/verifyContract", wait_until="domcontentloaded", timeout=120000)

        # --- step 1
        page.fill("#ContentPlaceHolder1_txtContractAddress", address)
        page.select_option("#ContentPlaceHolder1_ddlCompilerType", "3")
        page.wait_for_timeout(800)
        page.select_option("#ContentPlaceHolder1_ddlCompilerVersions", SOLC)
        page.select_option("#ContentPlaceHolder1_ddlLicenseType", "3")
        page.check("#chkTermsOfUse")
        page.click("#ContentPlaceHolder1_btnSubmit")
        page.wait_for_load_state("domcontentloaded", timeout=120000)
        page.wait_for_timeout(1500)
        print(f"[{label}] step1 -> {page.url}")
        if "verifyContract-solc-json" not in page.url:
            out["step1_error"] = page.inner_text("body")[:600]
            print(f"[{label}] STEP1 FAILED:", out["step1_error"])
            page.screenshot(path=f"/tmp/pw_{label}_1.png", full_page=True)
            browser.close()
            return 1

        # --- step 2: upload the standard-json (the upload button is d-none by default; the JS fired by set_input_files may auto-submit)
        page.set_input_files("#ContentPlaceHolder1_FileUpload1", sjis_path)
        page.wait_for_timeout(1500)
        try:
            page.wait_for_load_state("domcontentloaded", timeout=60000)
        except Exception:
            pass
        page.wait_for_timeout(1500)
        if page.locator("#ContentPlaceHolder1_FileUpload1").count() > 0:
            # no auto-submit → trigger it manually (drop d-none and click it, or call requestSubmit)
            print(f"[{label}] upload button not auto-triggered, submitting via JS")
            page.evaluate(
                "() => {const f=document.getElementById('ctl00');"
                "const b=document.getElementById('ContentPlaceHolder1_UploadButton');"
                "if(b){b.classList.remove('d-none');}"
                "if(f&&f.requestSubmit&&b){f.requestSubmit(b);} else if(f){f.submit();}}"
            )
            page.wait_for_load_state("domcontentloaded", timeout=180000)
            page.wait_for_timeout(2500)
        body = page.inner_text("body")
        open(f"/tmp/pw_{label}_s2.html", "w", encoding="utf-8").write(page.content())
        open(f"/tmp/pw_{label}_s2.txt", "w", encoding="utf-8").write(body)
        print(f"[{label}] step2 uploaded: tetxarea={page.locator('#ContentPlaceHolder1_txtConstructorArguements').count()}")
        if "Invalid" in body or "Error !" in body:
            print(f"[{label}] step2 warnings:", [l for l in body.split("\n") if "rror" in l or "Invalid" in l][:8])

        # --- step 3: wait for a Cloudflare Turnstile token (invisible mode usually passes on its own), then submit
        tok = wait_turnstile(page, label)
        print(f"[{label}] turnstile token present={tok}")
        if ctor:
            page.fill("#ContentPlaceHolder1_txtConstructorArguements", ctor)
        page.click("#ContentPlaceHolder1_btnSubmit")
        page.wait_for_load_state("domcontentloaded", timeout=240000)
        page.wait_for_timeout(4000)
        txt = page.inner_text("body")
        open(f"/tmp/pw_{label}_s3.html", "w", encoding="utf-8").write(page.content())
        open(f"/tmp/pw_{label}_s3.txt", "w", encoding="utf-8").write(txt)
        out["url"] = page.url
        out["result"] = "\n".join(
            [l for l in txt.split("\n") if l.strip() and not l.strip().startswith("$")][:60]
        )
        page.screenshot(path=f"/tmp/pw_{label}_final.png", full_page=True)
        browser.close()

    print(f"[{label}] final url: {out['url']}")
    print(f"[{label}] result text:\n{out['result'][:1500]}")
    json.dump(out, open(f"/tmp/pw_{label}_result.json", "w"), ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
