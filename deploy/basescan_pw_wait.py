#!/usr/bin/env python3
"""长等待版 Basescan 网页验证：Turnstile 若在 180s 内出 token 就提交，否则退出码 3。

用法: xvfb-run -a python3 deploy/basescan_pw_wait.py <address> <sjis.json> <ctor_hex> <label>
"""
import os
import sys
from playwright.sync_api import sync_playwright

BASE = "https://basescan.org"
SOLC = "v0.8.24+commit.e11b9ed9"


def main():
    address, sjis, ctor, label = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    ctor = ctor.replace("0x", "", 1)
    pxy = (os.environ.get("https_proxy") or "").replace("http://", "")
    host, _, port = pxy.partition(":")
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=False, args=["--no-sandbox"],
                               proxy={"server": f"http://{host}:{port}"})
        ctx = b.new_context(viewport={"width": 1440, "height": 1200}, locale="en-US")
        pg = ctx.new_page()
        pg.set_default_timeout(120000)
        pg.goto(f"{BASE}/verifyContract", wait_until="domcontentloaded")
        pg.fill("#ContentPlaceHolder1_txtContractAddress", address)
        pg.select_option("#ContentPlaceHolder1_ddlCompilerType", "3")
        pg.wait_for_timeout(700)
        pg.select_option("#ContentPlaceHolder1_ddlCompilerVersions", SOLC)
        pg.select_option("#ContentPlaceHolder1_ddlLicenseType", "3")
        pg.check("#chkTermsOfUse")
        pg.click("#ContentPlaceHolder1_btnSubmit")
        pg.wait_for_load_state("domcontentloaded")
        pg.set_input_files("#ContentPlaceHolder1_FileUpload1", sjis)
        pg.wait_for_timeout(1500)
        try:
            pg.wait_for_load_state("domcontentloaded", timeout=30000)
        except Exception:
            pass
        pg.wait_for_timeout(1500)
        if pg.locator("#ContentPlaceHolder1_FileUpload1").count() > 0:
            try:
                pg.evaluate("() => {const f=document.getElementById('ctl00');"
                            "const b=document.getElementById('ContentPlaceHolder1_UploadButton');"
                            "if(b)b.classList.remove('d-none');"
                            "if(f&&f.requestSubmit&&b){f.requestSubmit(b);}}")
            except Exception as e:
                print(f"[{label}] submit-evaluate skipped: {type(e).__name__}", flush=True)
            try:
                pg.wait_for_load_state("domcontentloaded", timeout=60000)
            except Exception:
                pass
            pg.wait_for_timeout(2000)
        print(f"[{label}] upload done, waiting turnstile", flush=True)

        tok = ""
        for i in range(90):          # 180s
            try:
                tok = pg.evaluate("() => {const i=document.querySelector('input[name=\"cf-turnstile-response\"]');"
                                  "return i?i.value:''}")
            except Exception:
                tok = ""
            if tok:
                break
            if i % 10 == 5:
                # 点一下 widget 区域，触发交互式校验
                try:
                    pg.mouse.click(720, 760)
                except Exception:
                    pass
            pg.wait_for_timeout(2000)
        print(f"[{label}] token={'YES' if tok else 'NO'} len={len(tok)}", flush=True)
        if not tok:
            b.close()
            return 3

        pg.fill("#ContentPlaceHolder1_txtConstructorArguements", ctor)
        pg.click("#ContentPlaceHolder1_btnSubmit")
        pg.wait_for_load_state("domcontentloaded")
        pg.wait_for_timeout(5000)
        txt = pg.inner_text("body")
        open(f"/tmp/wait_{label}_final.txt", "w").write(txt)
        open(f"/tmp/wait_{label}_final.html", "w").write(pg.content())
        lines = [l.strip() for l in txt.split("\n") if l.strip()]
        keep = [l for l in lines if any(k in l for k in
                ("Success", "success", "Error", "error", "Invalid", "match", "Pending",
                 "Congrat", "verified", "Verified", "Unable", "already"))]
        print(f"[{label}] URL={pg.url}", flush=True)
        print(f"[{label}] RESULT:", " | ".join(keep[-12:]), flush=True)
        b.close()
        return 0


if __name__ == "__main__":
    sys.exit(main())
