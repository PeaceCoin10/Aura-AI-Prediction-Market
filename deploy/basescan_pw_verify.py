#!/usr/bin/env python3
"""
用 Playwright 无人值守走 Basescan 官网 "Verify & Publish" 向导（无需 ETHERSCAN_API_KEY）。

Standard-Json-Input 流程需要真实浏览器 JS（服务端表单是 ASP.NET + JS 上传），
纯 POST 会卡在上传回发，所以用 Chromium 驱动。

用法：
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
    """等 Cloudflare Turnstile 生成 token；若有可见 checkbox 就先点掉。返回 token 是否有值。"""
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

        # --- 第 1 步
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

        # --- 第 2 步：上传 standard-json（上传按钮默认 d-none；set_input_files 触发的 JS 可能自动提交）
        page.set_input_files("#ContentPlaceHolder1_FileUpload1", sjis_path)
        page.wait_for_timeout(1500)
        try:
            page.wait_for_load_state("domcontentloaded", timeout=60000)
        except Exception:
            pass
        page.wait_for_timeout(1500)
        if page.locator("#ContentPlaceHolder1_FileUpload1").count() > 0:
            # 没自动提交 → 手动触发（去掉 d-none 后点它，或直接 requestSubmit）
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

        # --- 第 3 步：等 Cloudflare Turnstile 出 token（无感模式常自动通过），再提交
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
