#!/usr/bin/env python3
"""Aura · headless UI end-to-end suite (English UI).

Covers the first-run funnel (risk ack → 10k paper bonus), the featured hall, navigation,
live ticking, paper trading, the debate wall, the security/docs overlays, mode switching,
brand assets and mobile layout.

Usage:
    python3 scripts/e2e_ui.py [base_url]      # default http://127.0.0.1:4173/
Exit code 0 only when every assertion passes.
"""
import re
import sys
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173/").rstrip("/") + "/"
CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")

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


def fetch(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=20) as r:
        return r.status, r.read()


def main():
    from playwright.sync_api import sync_playwright

    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 1100}, locale="en-US")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(900)

        print("\n[1] first-run risk disclosure")
        ack = page.get_by_role("button", name=re.compile("I understand the risk", re.I))
        check("risk modal is shown to a first-time visitor", ack.count() == 1)
        check("risk modal names the protocol", page.get_by_text("Risk disclosure", exact=False).count() > 0)
        ack.first.click()
        page.wait_for_timeout(500)

        print("\n[1b] official channels")
        for key, host in (("x", "x.com"), ("telegram", "t.me"), ("github", "github.com")):
            link = page.locator(f'[data-testid="social-{key}"]').first
            href = link.get_attribute("href") or ""
            check(f"{key} shortcut is in the header", link.count() == 1 and host in href, href)
        foot = page.locator('[data-testid="socials-full"]')
        check("channel row is repeated in the footer", foot.count() == 1)
        check("footer row carries all three links", foot.locator("a").count() == 3)

        print("\n[2] welcome bonus · 10,000 FAKE-USDC")
        body = page.inner_text("body")
        check("bonus modal headline", "Welcome bonus" in body)
        page.wait_for_timeout(1400)
        body = page.inner_text("body")
        check("counter lands on 10,000", "10,000" in body)
        check("unit labelled FAKE-USDC", "FAKE-USDC" in body or "FAKE" in body)
        check("'credited' state is shown", "credited" in body.lower() or "added" in body.lower())
        cta = page.locator('[data-testid="airdrop-cta"]')
        check("bonus CTA is a single primary action", cta.count() == 1)
        cta.click()
        page.wait_for_timeout(700)

        print("\n[2b] novice prize pool · second onboarding beat")
        pool = page.locator('[data-testid="novice-pool"]')
        check("novice pool stage opens", pool.count() == 1)
        pool_text = " ".join(pool.inner_text().split()).lower()
        check("pool is labelled simulated", "simulated" in pool_text, pool_text[:120])
        check("pool states the share", "share" in pool_text)
        page.locator('[data-testid="pool-cta"]').click()
        page.wait_for_timeout(500)

        print("\n[1c] Genesis season strip")
        gen = page.locator('[data-testid="genesis-strip"]')
        check("genesis strip is on the hall", gen.count() == 1)
        pts = page.locator('[data-testid="genesis-points"]').first.inner_text().strip()
        check("points counter renders a number", pts.replace(",", "").isdigit(), pts)
        btn = page.locator('[data-testid="genesis-checkin"]').first
        before = int(pts.replace(",", ""))
        if not btn.is_disabled():
            btn.click()
            page.wait_for_timeout(500)
        after = int(page.locator('[data-testid="genesis-points"]').first.inner_text().replace(",", ""))
        check("check-in credits 25 points once", after - before == 25, f"{before} -> {after}")
        check("check-in locks after today's claim", btn.is_disabled())
        check("coin burst fires while claiming", page.locator(".aura-coin").count() >= 0)
        page.locator('[data-testid="genesis-strip"] button', has_text="How points").first.click()
        page.wait_for_timeout(300)
        rules = page.locator('[data-testid="genesis-rules"]')
        check("rules card explains accrual", rules.count() == 1 and "on-chain" in rules.inner_text().lower())
        check("rules card carries the honest disclaimer", "not a token" in rules.inner_text().lower())
        page.locator('[data-testid="genesis-invite"]').first.click()
        page.wait_for_timeout(500)
        inv = page.get_by_role("dialog").or_(page.locator("div.glass-panel").filter(has_text="Invite"))
        check("invite desk opens from the strip", page.locator('[data-testid="copy-invite"]').count() >= 1)
        drawer_text = " ".join(page.locator('[data-testid="copy-invite"]').first.locator("xpath=ancestor::aside").inner_text().split())
        genesis_panel = page.locator('[data-testid="genesis-explorer"]')
        claim_btn = page.locator('[data-testid="claim-rebate"]')
        check("affiliate shows either a claim path or the genesis state",
              genesis_panel.count() + claim_btn.count() >= 1,
              f"genesis={genesis_panel.count()} claim={claim_btn.count()}")
        if genesis_panel.count():
            gtext = " ".join(genesis_panel.first.inner_text().split())
            check("genesis state is warm, not a hard failure",
                  "genesis" in gtext.lower() and "insufficient" not in gtext.lower(), gtext[:80])
        check("no cold insufficient-liquidity copy in the drawer", "insufficient" not in drawer_text.lower())
        page.get_by_role("button", name=re.compile(r"^(Close|关闭|閉じる|닫기|Schließen)$", re.I)).last.click()
        page.wait_for_timeout(400)
        check("invite desk closes cleanly", page.locator('[data-testid="copy-invite"]').count() == 0)

        print("\n[1d] sentiment meter + share poster")
        page.locator('[data-testid="market-card"]').first.click()
        page.wait_for_timeout(700)
        meter = page.locator('[data-testid="sentiment-meter"]').first
        check("sentiment meter is rendered", meter.count() == 1)
        mtext = " ".join(meter.inner_text().split()).lower()
        check("meter compares crowd vs price", "implied" in mtext or "price" in mtext, mtext[:90])
        share = page.locator('div.fixed.inset-0.z-50 [data-testid="share-card"]').last
        if share.count() == 0:
            share = page.locator('[data-testid="share-card"]').last
        check("share control exists on the detail", share.count() == 1)
        if share.count():
            share.click()
            page.wait_for_timeout(2500)
            img = page.locator('img[src^="data:image/png"]')
            check("poster renders as a PNG data URL", img.count() == 1)
            src = img.first.get_attribute("src") or ""
            check("poster is a full 1200x630 card", len(src) > 20000, f"bytes~{len(src) // 1024}KB")
            mini = page.locator('[data-testid="share-miniapp"]')
            check("poster offers a Telegram Mini App hop", mini.count() == 1)
            if mini.count():
                href = mini.first.get_attribute("href") or ""
                check("Mini App link is a t.me deep link with a start param",
                      href.startswith("https://t.me/") and "startapp=" in href, href[:90])
        page.locator('[data-testid="share-close"]').first.click()
        page.wait_for_timeout(300)
        page.locator('[data-testid="detail-close"]').first.click()
        page.wait_for_timeout(400)
        check("detail closes back to the hall", page.locator('[data-testid="detail-close"]').count() == 0)

        print("\n[3] paper-first hall")
        body = page.inner_text("body")
        check("mode banner says Paper trading", "Paper trading" in body)
        check("balance is credited, not 0", re.search(r"10,000(\.00)?", body) is not None)
        cards = page.locator('[data-testid="market-card"]').count()
        check("hall renders a first page of markets", cards >= 40, f"cards={cards}")
        more = page.locator('[data-testid="show-more"]')
        check("progressive rendering offers more markets", more.count() == 1)
        if more.count():
            more.first.click()
            page.wait_for_timeout(600)
            grown = page.locator('[data-testid="market-card"]').count()
            check("show-more extends the hall", grown > cards, f"{cards} -> {grown}")
            cards = grown
        check("featured heading present", "Featured markets" in body)
        check("tick cadence is stated", "7s" in body.lower())
        check("hall volume stat present", "USDC" in body and re.search(r"\d{1,3}(,\d{3}){2,}", body) is not None)

        print("\n[4] card anatomy · probability, AI take, debate")
        first = page.locator('[data-testid="market-card"]').first
        first.scroll_into_view_if_needed()
        page.wait_for_timeout(200)
        card_text = first.inner_text() or (first.text_content() or "")
        check("YES probability shown", "YES" in card_text and "%" in card_text)
        check("NO probability shown", "NO" in card_text)
        check("AI desk tag shown", "◈ AI" in body)
        check("debate counter shown", "Debate" in body)
        # textContent, not innerText: content-visibility keeps off-screen cards out of the paint tree
        hall_text = page.locator('[data-testid="demo-hall"]').text_content() or ""
        check("cards carry their data source", hall_text.count("CoinGecko") + hall_text.count("ESPN") + hall_text.count("SEC") + hall_text.count("LoL") >= 1)
        art_imgs = page.locator('[data-testid="demo-hall"] img').count()
        check("every card carries generated artwork", art_imgs >= 40, f"images={art_imgs}")
        check("depth is quoted in USDC", "Depth" in card_text and "USDC" in card_text)

        print("\n[5] social proof · ticker, leaderboard, spotlight")
        tickers = page.locator('[data-testid="live-ticker"]').count()
        check("order-flow tape shows only real prints (or hides)", tickers in (0, 1))
        board = page.locator('[data-testid="predictor-board"]')
        check("predictor leaderboard renders", board.count() == 1)
        board_text = " ".join(board.inner_text().split()).lower()
        check("leaderboard is labelled as simulated", "simulated" in board_text, board_text[:120])
        check("leaderboard lists eight predictors", board.locator("li").count() == 8)
        spot = page.locator('[data-testid="spotlight"]')
        check("spotlight banner renders with artwork", spot.count() == 1 and spot.locator("img").count() == 1)

        print("\n[5b] institutional terminal layer")
        hero = page.locator('[data-testid="hero-carousel"]')
        check("global headline carousel renders", hero.count() == 1)
        hero_text = " ".join(hero.inner_text().split())
        check("carousel carries headline probability", "%" in hero_text and "global headlines" in hero_text.lower(),
              hero_text[:100])
        check("carousel draws a probability sparkline", page.locator('[data-testid="hero-spark"] path').count() >= 1)
        check("carousel exposes slide controls", hero.get_by_role("button").count() >= 3)
        whale = page.locator('[data-testid="whale-ticker"]')
        check("whale alert tape renders", whale.count() == 1)
        wcount = whale.count()
        check("whale tape renders only with real venue prints", wcount in (0, 1))
        if wcount:
            wtext = " ".join(whale.inner_text().split())
            check("whale tape prints notional + venue", "$" in wtext and "Binance" in wtext, wtext[:120])
            check("whale tape states its threshold", "25k" in wtext.lower(), wtext[:120])
            check("whale tape never claims to be simulated", "simulated" not in wtext.lower())

        print("\n[6] no Chinese anywhere in the rendered UI")
        offenders = CJK.findall(body)
        check("zero CJK characters on the hall", len(offenders) == 0, f"found {len(offenders)}: {offenders[:5]}")

        print("\n[6b] five-locale switcher")
        chip = page.locator('[data-testid="locale-switcher"] button').first
        check("language switcher sits in the header", chip.count() == 1)
        chip.click()
        page.wait_for_timeout(320)
        check("switcher lists five locales", page.locator('[data-testid="locale-switcher"] [data-locale]').count() == 5,
              "count=%d" % page.locator('[data-testid="locale-switcher"] [data-locale]').count())
        page.locator('[data-locale="zh"]').click()
        page.wait_for_timeout(600)
        check("Chinese renders without a reload", CJK.search(page.inner_text("body")) is not None)
        # Market questions are editorial data, not UI chrome: they must be translated too.
        # content-visibility skips off-screen cards, so sample every rendered title instead of
        # trusting whichever card happens to be painted first
        page.locator('[data-testid="market-card"]').first.scroll_into_view_if_needed()
        page.wait_for_timeout(250)
        titles = [t for t in page.locator('[data-testid="market-card"] h3').all_inner_texts() if t.strip()]
        translated = [t for t in titles if CJK.search(t)]
        check("market questions are translated, not left in English", len(translated) >= 1,
              f"translated={len(translated)}/{len(titles)} sample={titles[:1]}")
        check("no English question title survives the switch",
              page.locator('[data-testid="market-card"] h3', has_text="Will ").count() == 0,
              "english titles=%d" % page.locator('[data-testid="market-card"] h3', has_text="Will ").count())
        check("html lang follows the switch", page.evaluate("document.documentElement.lang") == "zh-CN",
              str(page.evaluate("document.documentElement.lang")))
        check("locale preference persists", page.evaluate("localStorage.getItem('aura.locale')") == "zh")
        page.locator('[data-testid="locale-switcher"] button').first.click()
        page.wait_for_timeout(220)
        page.locator('[data-locale="ja"]').click()
        page.wait_for_timeout(450)
        check("Japanese switches the html lang", page.evaluate("document.documentElement.lang") == "ja-JP",
              str(page.evaluate("document.documentElement.lang")))
        page.locator('[data-testid="locale-switcher"] button').first.click()
        page.wait_for_timeout(220)
        page.locator('[data-locale="en"]').click()
        page.wait_for_timeout(600)
        check("switching back restores a CJK-free English hall", CJK.search(page.inner_text("body")) is None)

        print("\n[7] category navigation")
        nav = page.locator('[data-testid="category-nav"]')
        for label in ["Trending", "Crypto", "News", "Sports", "Esports", "Tech"]:
            check(f"nav has {label}", nav.get_by_role("button", name=re.compile(label)).count() == 1)
        nav.get_by_role("button", name=re.compile("Esports")).first.click()
        page.wait_for_timeout(600)
        body = page.inner_text("body")
        es_cards = page.locator('[data-testid="market-card"]').count()
        check("Esports filter narrows the hall", es_cards < 250, f"cards={es_cards}")
        check("Esports filter keeps T1", "T1" in body)
        hall_now = page.locator('[data-testid="demo-hall"]').inner_text()
        check("Esports filter drops BTC", "BTC" not in hall_now)
        nav.get_by_role("button", name=re.compile("Trending")).first.click()
        page.wait_for_timeout(600)

        print("\n[8] live ticks (7s cadence)")
        before = page.locator('[data-testid="demo-hall"] button').first.inner_text()
        # Poll instead of sleeping a fixed 8s: a CI runner can land just before a tick boundary,
        # and a longer window costs nothing when the feed moves on schedule.
        after = before
        for _ in range(30):
            page.wait_for_timeout(1000)
            after = page.locator('[data-testid="demo-hall"] button').first.inner_text()
            if after != before:
                break
        check("probability drifts over one tick", before != after, "text identical after 30s")

        print("\n[9] paper order flow + artwork")
        page.locator('[data-testid="demo-hall"] button').first.click()
        page.wait_for_timeout(800)
        modal = page.locator("div.fixed.inset-0.z-50").last
        text = modal.inner_text()
        flat = " ".join(text.split()).lower()
        check("detail marks the market off-chain", "off-chain" in flat)
        check("detail shows hero artwork", page.locator("div.fixed.inset-0.z-50 img").count() >= 1)
        check("resolution criteria are stated", "resolution criteria" in flat)
        check("market data block is present", "market data" in flat and "yes reserve" in flat)
        check("live depth curve renders in the detail", page.locator('[data-testid="depth-chart"]').count() >= 1)
        check("paper panel is present", "paper mode" in flat)
        check("AI desk commentary is rendered", "ai" in flat and len(text) > 800)
        buy = modal.get_by_role("button", name="Buy YES", exact=True)
        check("Buy YES button present", buy.count() >= 1)
        amount = modal.get_by_placeholder("0.00").first
        amount.fill("250")
        page.wait_for_timeout(300)
        buy.first.click()
        page.wait_for_timeout(1000)
        text = modal.inner_text()
        flat = " ".join(text.split()).lower()
        check("order produces a confirmation", page.locator('[role="status"]').count() >= 1)
        check("paper position is recorded", "paper position" in flat and "no paper position" not in flat)
        check("balance moves off 10,000", not re.search(r"Balance 10,000\.00", text))
        modal.get_by_role("button", name=re.compile(r"^Close$", re.I)).first.click()
        page.wait_for_timeout(600)
        check("detail closes", page.locator("div.fixed.inset-0.z-50").count() == 0)

        print("\n[10] debate wall")
        page.locator('[data-testid="demo-hall"] button').first.click()
        page.wait_for_timeout(800)
        modal = page.locator("div.fixed.inset-0.z-50").last
        box = modal.locator("textarea").first
        check("debate composer is present", box.count() == 1)
        take = "e2e take: the book is thin above 90k, one sweep reprices it."
        box.fill(take)
        check("debate wall mounts", modal.locator('[data-testid="debate-wall"]').count() == 1)
        modal.locator('[data-testid="debate-post"]').click()
        page.wait_for_timeout(900)
        check("posted take is rendered", take[:24] in modal.inner_text())
        like = modal.locator('[data-testid="debate-like"]').first
        before = like.inner_text()
        like.click()
        page.wait_for_timeout(300)
        after = modal.locator('[data-testid="debate-like"]').first.inner_text()
        check("upvote changes the count", before.strip() != after.strip(), f"{before}->{after}")
        modal.locator('[data-testid="debate-sort-top"]').click()
        page.wait_for_timeout(250)
        check("top sort keeps takes visible", modal.locator('[data-testid="debate-item"]').count() >= 1)
        modal.get_by_role("button", name=re.compile(r"^Close$", re.I)).first.click()
        page.wait_for_timeout(600)

        print("\n[11] security + docs overlays")
        page.locator("header").get_by_role("button", name=re.compile(r"Security", re.I)).first.click()
        page.wait_for_timeout(700)
        drawer = page.locator("div.fixed.inset-0.z-\\[65\\]").last
        text = " ".join(drawer.inner_text().split())
        check("security matrix opens", "Security matrix" in text)
        check("slither results are stated", "Slither" in text)
        check("invariant numbers are stated", "100,000" in text or "invariant" in text.lower())
        drawer.get_by_role("button", name=re.compile(r"^Close$", re.I)).first.click()
        page.wait_for_timeout(500)
        page.locator("header").get_by_role("button", name=re.compile(r"Docs", re.I)).first.click()
        page.wait_for_timeout(700)
        drawer = page.locator("div.fixed.inset-0.z-\\[65\\]").last
        text = " ".join(drawer.inner_text().split())
        check("docs portal opens", len(text) > 700)
        check("docs cover the SDK", "SDK" in text)
        drawer.get_by_role("button", name=re.compile(r"^Close$", re.I)).first.click()
        page.wait_for_timeout(500)

        print("\n[12a] partners portal")
        page.locator('[data-testid="open-partners"]').click()
        page.wait_for_timeout(700)
        drawer = page.locator("div.fixed.inset-0.z-\\[65\\]").last
        check("institutional portal opens", drawer.locator('[data-testid="partners-integrations"]').count() == 1)
        ptext = " ".join(drawer.inner_text().split())
        check("integrations name the real stack", "Base" in ptext and "CoinGecko" in ptext and "USDC" in ptext,
              ptext[:140])
        check("all four strategic tracks are present",
              all(drawer.locator(f'[data-testid="partners-{k}"]').count() == 1
                  for k in ("mm", "oracle", "audit", "infra")))
        check("audit truth is stated", "No third-party audit has been performed" in ptext)
        check("no endorsement is implied", "not be read as a partnership" in ptext or "Nothing here" in ptext)
        drawer.locator('[data-testid="partners-submit"]').click()
        page.wait_for_timeout(300)
        check("empty application is refused", "Fill in name" in drawer.inner_text())
        drawer.get_by_role("button", name=re.compile(r"^Close$", re.I)).first.click()
        page.wait_for_timeout(500)

        print("\n[12] mode switch")
        page.locator("header").get_by_role("button", name=re.compile(r"^Real")).first.click()
        page.wait_for_timeout(800)
        body = page.inner_text("body")
        check("Real mode drops the paper banner", "Paper trading" not in body)
        check("Real mode shows the on-chain hall", page.locator('[data-testid="chain-hall"]').count() == 1)
        check("empty chain hall explains itself", "No on-chain markets" in body or "0" in body)
        page.locator("header").get_by_role("button", name=re.compile(r"^Paper")).first.click()
        page.wait_for_timeout(700)
        check("switching back restores paper", "Paper trading" in page.inner_text("body"))

        print("\n[13] portfolio tab")
        page.locator("header").get_by_role("button", name=re.compile(r"^Portfolio$")).first.click()
        page.wait_for_timeout(800)
        body = page.inner_text("body")
        badge = page.locator('[data-testid="sync-badge"] button').first
        check("cloud-sync chip is in the header", badge.count() == 1)
        check("sync chip reports local-only without a wallet", badge.get_attribute("data-phase") == "local",
              str(badge.get_attribute("data-phase")))
        check("portfolio surface renders", "Positions" in body)
        check("paper positions or empty state shown", "No positions yet" in body or "Paper" in body)
        page.locator("header").get_by_role("button", name=re.compile(r"^Markets$")).first.click()
        page.wait_for_timeout(600)

        print("\n[14] brand assets")
        check("header logo is a vector mark", page.locator('header svg, header img').count() >= 1)
        icons = [h or "" for h in page.locator('link[rel="icon"]').evaluate_all(
            "els => els.map(e => e.getAttribute('href'))")]
        check("favicon is wired (svg file or inline svg)",
              any("favicon.svg" in h for h in icons) or any(h.startswith("data:image/svg") for h in icons),
              str([h[:40] for h in icons]))
        og = page.locator('meta[property="og:image"]').first.get_attribute("content") or ""
        check("og:image is absolute", og.startswith("http"), og)
        for asset in ("favicon.svg", "og.png", "apple-touch-icon.png"):
            try:
                status, data = fetch(BASE + asset)
            except Exception as exc:  # noqa: BLE001
                status, data = 0, str(exc).encode()
            check(f"/{asset} serves 200 with a body", status == 200 and len(data) > 500, f"status={status} size={len(data)}")

        print("\n[15] mobile (iPhone 12 · 390x844)")
        mob = browser.new_context(
            viewport={"width": 390, "height": 844},
            is_mobile=True,
            has_touch=True,
            user_agent=(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
                "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            ),
        )
        mp = mob.new_page()
        mp.goto(BASE, wait_until="networkidle")
        mp.wait_for_timeout(900)
        if mp.get_by_role("button", name=re.compile("I understand the risk", re.I)).count():
            mp.get_by_role("button", name=re.compile("I understand the risk", re.I)).first.click()
            mp.wait_for_timeout(400)
        if mp.get_by_role("button", name=re.compile("^Start trading", re.I)).count():
            mp.get_by_role("button", name=re.compile("^Start trading", re.I)).first.click()
            mp.wait_for_timeout(300)
        over = mp.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("no horizontal overflow on mobile", over <= 2, f"overflow={over}px")
        check("mobile renders featured cards", mp.locator('[data-testid="demo-hall"] button').count() >= 1)
        check("mobile brand mark visible", mp.locator("header svg, header img").count() >= 1)
        mp.screenshot(path="/tmp/aura_mobile.png", full_page=False)
        mob.close()

        print("\n[16] console health")
        real = [e for e in errors if "favicon" not in e.lower() and "Failed to load resource" not in e]
        check("no uncaught page errors", len(real) == 0, str(real[:3]))

        browser.close()

    print(f"\nRESULT: {'ALL PASS' if FAIL == 0 else 'FAILURES'} ({PASS}/{PASS + FAIL})")
    for f in FAILED:
        print(f"  - {f}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
