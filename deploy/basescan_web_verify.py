#!/usr/bin/env python3
"""
Basescan web-based contract verification (no ETHERSCAN_API_KEY needed) — the Etherscan ASP.NET wizard.

  1) GET  /verifyContract                scrape __VIEWSTATE/__EVENTVALIDATION
  2) POST /verifyContract                address + Solidity(Standard-Json-Input) + solc + license
  3) POST /verifyContract-solc-json?...  multipart upload of the standard-json (FileUpload1 + UploadButton)
  4) POST the same action                constructor args + Verify and Publish

Usage:
  python3 deploy/basescan_web_verify.py <address> <label> <sjis.json> [ctor_args_hex]
"""
import re
import sys
import html
import requests

BASE = "https://basescan.org"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
SOLC = "v0.8.24+commit.e11b9ed9"
LICENSE_MIT = "3"
HIDDEN = ("__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION")
CP = "ctl00$ContentPlaceHolder1$"


def hidden(page):
    out = {}
    for n in HIDDEN:
        m = re.search(r'name="%s"[^>]*value="([^"]*)"' % re.escape(n), page)
        if m:
            out[n] = html.unescape(m.group(1))
    return out


def action_of(page):
    m = (re.search(r'<form[^>]*method="post"[^>]*action="([^"]+)"', page)
         or re.search(r'<form[^>]*action="([^"]+)"[^>]*method="post"', page))
    return html.unescape(m.group(1)).lstrip("./") if m else "verifyContract"


def hidden_val(page, name):
    m = re.search(r'name="%s"[^>]*value="([^"]*)"' % re.escape(name), page)
    if not m:
        m = re.search(r'id="%s"[^>]*value="([^"]*)"' % re.escape(name), page)
    return html.unescape(m.group(1)) if m else ""


def plain(page, n=900):
    t = re.sub(r"<script.*?</script>", " ", page, flags=re.S)
    t = re.sub(r"<style.*?</style>", " ", t, flags=re.S)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", t)[n // 2:][:n]


def main():
    address, label, sjis_path = sys.argv[1], sys.argv[2], sys.argv[3]
    ctor = (sys.argv[4] if len(sys.argv) > 4 else "").replace("0x", "", 1)
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})

    # ---- 1) scrape the form
    r = s.get(f"{BASE}/verifyContract", timeout=60)
    r.raise_for_status()
    act1 = action_of(r.text)
    d = hidden(r.text)
    d.update({
        CP + "txtContractAddress": address,
        CP + "ddlCompilerType": "3",
        CP + "ddlCompilerVersions": SOLC,
        CP + "chkShowAllCommits": "on",
        CP + "ddlLicenseType": LICENSE_MIT,
        "chkTermsOfUse": "on",
        CP + "btnSubmit": "Continue",
    })
    r2 = s.post(f"{BASE}/{act1}", data=d, timeout=90,
                headers={"Referer": f"{BASE}/verifyContract"})
    if "verifyContract-solc-json" not in r2.text:
        print(f"[{label}] step1 REJECTED:", plain(r2.text))
        return 1
    act2 = action_of(r2.text)
    sessid = hidden_val(r2.text, CP + "sessid")
    print(f"[{label}] step1 ok -> {act2}  sessid={sessid}")

    # ---- 2) upload the standard-json
    d = hidden(r2.text)
    d.update({
        CP + "sessid": sessid,
        CP + "libcounter": "1",
        CP + "hdnSelectedTab": "0",
        CP + "ddlLicenseType": LICENSE_MIT,
        CP + "txtConstructorArguements": "",
        CP + "txtJsonContractLibraryAddress": "",
        CP + "UploadButton": "Click to Upload selected file",
    })
    raw = open(sjis_path, "rb").read()
    r3 = s.post(f"{BASE}/{act2}", data=d,
                files={CP + "FileUpload1": (label + ".json", raw, "application/json")},
                timeout=300, headers={"Referer": f"{BASE}/{act2}"})
    open(f"/tmp/bs_s3_{label}.html", "w", encoding="utf-8").write(r3.text)
    ok = "txtConstructorArguements" in r3.text and "FileUpload1" not in r3.text
    print(f"[{label}] upload http={r3.status_code} parsed={ok}")
    if not ok:
        print(f"[{label}] upload page:", plain(r3.text))
        return 1

    # ---- 3) constructor args + submit
    act3 = action_of(r3.text)
    d = hidden(r3.text)
    d.update({
        CP + "sessid": sessid,
        CP + "libcounter": "1",
        CP + "hdnSelectedTab": "0",
        CP + "ddlLicenseType": LICENSE_MIT,
        CP + "txtConstructorArguements": ctor,
        CP + "txtJsonContractLibraryAddress": "",
        CP + "btnSubmit": "Verify and Publish",
    })
    r4 = s.post(f"{BASE}/{act3}", data=d, timeout=300,
                headers={"Referer": f"{BASE}/{act3}"})
    open(f"/tmp/bs_s4_{label}.html", "w", encoding="utf-8").write(r4.text)
    print(f"[{label}] submit http={r4.status_code}")
    print(f"[{label}] result:", plain(r4.text, 1400))
    return 0


if __name__ == "__main__":
    sys.exit(main())
