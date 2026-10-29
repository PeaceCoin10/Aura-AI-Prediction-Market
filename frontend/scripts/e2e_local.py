#!/usr/bin/env python3
"""Aura · local real-chain end-to-end suite (English UI).

Boots a headless browser against a local anvil deployment with an injected EIP-1193 wallet and
walks the real path: first-run overlay → switch to Real → read the on-chain hall → connect →
quote → buy → position → event feed.

Prerequisites (see docs/DEVELOPMENT.md):
    anvil --chain-id 8453 --port 8545
    forge script script/DeployCentral.s.sol:DeployCentral --rpc-url http://127.0.0.1:8545 \
        --broadcast -vv   (with PRIVATE_KEY set, SEED_DEMO=1)
    MockUSDC mint + approve for the test account
    frontend built with VITE_ENGINE_ADDRESS / VITE_USDC_ADDRESS / VITE_RPC_URL pointing at anvil

Usage:
    python3 scripts/e2e_local.py [url] [rpc]
Defaults: url=http://127.0.0.1:5173/  rpc=http://127.0.0.1:8545
"""
import json
import re
import sys

from playwright.sync_api import sync_playwright

URL = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5173/").rstrip("/") + "/"
RPC = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8545"
ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"  # anvil #1
QUESTION = "Demo market: will BTC close up 1.5% within 24 hours?"

INJECT = """
(() => {
  const RPC = "%s";
  const ACCOUNT = "%s";
  let id = 1;
  const provider = {
    isMetaMask: true,
    async request({ method, params }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNT];
      if (method === "eth_chainId") return "0x2105";
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      const body = { jsonrpc: "2.0", id: id++, method, params: params || [] };
      if (method === "eth_sendTransaction" && body.params[0] && !body.params[0].from) {
        body.params[0].from = ACCOUNT;
      }
      const res = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (json.error) { const e = new Error(json.error.message); e.code = json.error.code; throw e; }
      return json.result;
    },
    on() {}, removeListener() {},
  };
  window.ethereum = provider;
  const info = { uuid: "e2e-fake", name: "E2E wallet", icon: "", rdns: "e2e.fake" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info, provider } }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();
""" % (RPC, ACCOUNT)


def main():
    steps = []
    errs = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = b.new_context(viewport={"width": 1440, "height": 1000}, locale="en-US")
        ctx.add_init_script(INJECT)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)

        pg.goto(URL, wait_until="networkidle", timeout=90_000)
        pg.wait_for_timeout(2500)

        # 0) compliance + welcome overlays, exactly as a first-time visitor meets them
        ack = pg.get_by_role("button", name=re.compile("I understand the risk", re.I))
        if ack.count():
            ack.first.click()
            pg.wait_for_timeout(1600)
        start = pg.locator('[data-testid="airdrop-cta"]')
        if start.count():
            start.click()
            pg.wait_for_timeout(600)
        pool = pg.locator('[data-testid="pool-cta"]')
        if pool.count():
            pool.click()
            pg.wait_for_timeout(400)

        # this suite exercises real-chain trading, so switch out of the default paper mode
        pg.locator("header").get_by_role("button", name=re.compile(r"^Real")).first.click()
        pg.wait_for_timeout(1200)

        body = pg.inner_text("body")
        steps.append(("on-chain hall lists the seeded market", QUESTION in body))
        steps.append(("probability is quoted from reserves", re.search(r"\d+\.\d%", body) is not None))
        steps.append(("chain section is separate from featured", pg.locator('[data-testid="chain-hall"]').count() == 1))

        # connect the injected wallet
        pg.locator("header").get_by_role("button", name=re.compile("Connect wallet", re.I)).first.click()
        pg.wait_for_timeout(600)
        pg.get_by_role("button", name=re.compile("E2E wallet")).click()
        pg.wait_for_timeout(1800)
        body = pg.inner_text("body")
        steps.append(("wallet connects (address + USDC balance)", "0x7099" in body and "USDC" in body))

        # open the on-chain market from the chain hall only
        pg.locator('[data-testid="chain-hall"]').get_by_text(QUESTION).first.click()
        pg.wait_for_timeout(1500)
        sheet = pg.locator("div.fixed.inset-0.z-50").last
        text = " ".join(sheet.inner_text().split())
        steps.append(("detail sheet opens", "market data" in text.lower()))
        steps.append(("settlement rules are stated", "Rules" in text))

        # quote 20 USDC
        amount = sheet.get_by_placeholder("0.00").first
        amount.fill("20")
        pg.wait_for_timeout(2600)
        text = " ".join(sheet.inner_text().split())
        steps.append(("on-chain quote appears", "on-chain quote" in text.lower() or "You receive" in text))
        steps.append(("price impact is shown", "Price impact" in text))

        # buy
        sheet.get_by_role("button", name=re.compile(r"^Buy YES", re.I)).first.click()
        pg.wait_for_timeout(7000)
        after = pg.inner_text("body")
        steps.append(("trade is confirmed on-chain", "Confirmed on-chain" in after or "SharesBought" in after))
        pg.screenshot(path="/tmp/fe_after_buy.png", full_page=True)

        # portfolio
        sheet.get_by_role("button", name=re.compile(r"^Close$", re.I)).first.click()
        pg.wait_for_timeout(500)
        pg.locator("header").get_by_role("button", name=re.compile(r"^Portfolio$")).first.click()
        pg.wait_for_timeout(3500)
        port = pg.inner_text("body")
        m = re.search(r"YES (\d+(?:\.\d+)?)", port)
        steps.append((f"portfolio shows shares ({m.group(0) if m else 'none'})", bool(m) and float(m.group(1)) > 0))
        print("---- portfolio text ----")
        print("\n".join([ln for ln in port.split("\n") if ln.strip()][:24]))
        pg.screenshot(path="/tmp/fe_portfolio.png", full_page=True)

        # event feed
        pg.locator("header").get_by_role("button", name=re.compile(r"^On-chain$")).first.click()
        pg.wait_for_timeout(4000)
        act = pg.inner_text("body")
        steps.append(("event feed shows the fill", "Buy filled" in act or "SharesBought" in act))
        steps.append(("feed shows the seed + creation history", "Liquidity seeded" in act and "Market created" in act))
        pg.screenshot(path="/tmp/fe_activity.png", full_page=True)
        b.close()

    ok = True
    for name, passed in steps:
        print(("PASS " if passed else "FAIL ") + name)
        ok = ok and passed
    hard = [e for e in errs if "429" not in e and "AudioContext" not in e and "Download the React" not in e]
    if hard:
        print("---- page errors ----")
        for e in hard[:8]:
            print(" ", e)
    print("RESULT:", "ALL PASS" if ok and not hard else "HAS FAILURES")
    return 0 if ok and not hard else 1


if __name__ == "__main__":
    sys.exit(main())
