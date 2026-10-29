#!/usr/bin/env python3
"""
hermes/test_verticals.py -- offline unit tests for the multi-vertical drafting module
(no chain, no network).

Run:
    cd hermes && python3 -m unittest -v test_verticals.py
"""

from __future__ import annotations

import tempfile
import time
import unittest

import hermes_brain as hb
import verticals as v


RSS_SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>CoinDesk</title>
  <item>
    <title>SEC approves spot ETH staking ETF in landmark vote - CoinDesk</title>
    <link>https://example.com/a</link>
    <pubDate>Tue, 27 Oct 2026 09:30:00 GMT</pubDate>
  </item>
  <item>
    <title>Ethereum foundation publishes new roadmap</title>
    <link>https://example.com/b</link>
    <pubDate>Tue, 27 Oct 2026 08:00:00 GMT</pubDate>
  </item>
</channel></rss>"""

ATOM_SAMPLE = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Fed signals pause on rate hikes</title>
    <link href="https://example.com/c"/>
    <updated>2026-10-27T07:15:00Z</updated>
  </entry>
</feed>"""

ESPN_SAMPLE = {
    "events": [
        {
            "id": "401",
            "date": "2026-10-28T00:30:00Z",
            "status": {"type": {"state": "pre"}},
            "competitions": [
                {
                    "status": {"type": {"state": "pre"}},
                    "competitors": [
                        {"homeAway": "home", "team": {"displayName": "Los Angeles Lakers"}, "score": "0"},
                        {"homeAway": "away", "team": {"displayName": "Boston Celtics"}, "score": "0"},
                    ],
                }
            ],
        },
        {
            "id": "402",
            "date": "2026-10-26T00:30:00Z",
            "status": {"type": {"state": "post"}},
            "competitions": [
                {
                    "status": {"type": {"state": "post"}},
                    "competitors": [
                        {"homeAway": "home", "team": {"displayName": "Arsenal"}, "score": {"value": 2}},
                        {"homeAway": "away", "team": {"displayName": "Chelsea"}, "score": {"value": 1}},
                    ],
                }
            ],
        },
    ]
}

def _iso(hours_from_now: float) -> str:
    """Fixtures must be generated relative to "now": hardcoded dates rot as real time passes."""
    from datetime import datetime, timedelta, timezone

    return (datetime.now(timezone.utc) + timedelta(hours=hours_from_now)).strftime("%Y-%m-%dT%H:%M:%SZ")


LOL_SAMPLE = {
    "data": {
        "schedule": {
            "events": [
                {
                    "startTime": _iso(10),
                    "state": "upcoming",
                    "league": {"name": "Worlds"},
                    "match": {"id": "m1", "teams": [{"name": "T1"}, {"name": "Gen.G"}]},
                },
                {
                    "startTime": _iso(-30),
                    "state": "completed",
                    "league": {"name": "Worlds"},
                    "match": {
                        "id": "m2",
                        "teams": [
                            {"name": "JDG", "result": {"gameWins": 3}},
                            {"name": "BLG", "result": {"gameWins": 1}},
                        ],
                    },
                },
            ]
        }
    }
}


class TestBinaryQuestionValidation(unittest.TestCase):
    NOW = 1_800_000_000

    def test_accepts_well_formed_binary_question(self):
        ok, why = v.validate_binary_question(
            "Will BTC close above $105,000 within 24 hours?",
            "Settled from the CoinGecko close: at or above 105000 resolves YES, otherwise NO.",
            self.NOW + 24 * 3600, self.NOW,
        )
        self.assertTrue(ok, why)

    def test_rejects_non_binary_phrasing(self):
        ok, why = v.validate_binary_question(
            "How high will BTC go?",
            "Settled from the CoinGecko close by comparing the two values.",
            self.NOW + 86400, self.NOW)
        self.assertFalse(ok)
        self.assertIn("binary-aligned", why)

    def test_rejects_multi_outcome_word(self):
        ok, why = v.validate_binary_question(
            "Will BTC close at 100000 or 120000?",
            "Settled from the CoinGecko close, one of the two values.",
            self.NOW + 86400, self.NOW)
        self.assertFalse(ok)

    def test_rejects_missing_criteria(self):
        ok, why = v.validate_binary_question("Will ETH close above $5,000?", "short", self.NOW + 86400, self.NOW)
        self.assertFalse(ok)
        self.assertIn("criteria", why)

    def test_rejects_resolution_too_soon_or_too_far(self):
        ok, why = v.validate_binary_question(
            "Will ETH close above $5,000?",
            "Settled from the CoinGecko close: at or above 5000 resolves YES.",
            self.NOW + 60, self.NOW)
        self.assertFalse(ok)
        self.assertIn("at least", why)

        ok2, why2 = v.validate_binary_question(
            "Will ETH close above $5,000?",
            "Settled from the CoinGecko close: at or above 5000 resolves YES.",
            self.NOW + 9 * 86400, self.NOW)
        self.assertFalse(ok2)
        self.assertIn("too far", why2)

    def test_rejects_question_without_question_mark(self):
        ok, why = v.validate_binary_question(
            "Will ETH close above $5,000",
            "Settled from the CoinGecko close: at or above 5000 resolves YES.",
            self.NOW + 86400, self.NOW)
        self.assertFalse(ok)
        self.assertIn("question mark", why)


class TestNewsFeed(unittest.TestCase):
    def test_parse_rss_items(self):
        feed = v.NewsFeed()
        heads = feed.parse_rss(RSS_SAMPLE, "CoinDesk", "news")
        self.assertEqual(len(heads), 2)
        self.assertEqual(heads[0].source, "CoinDesk")
        self.assertIn("SEC approves", heads[0].title)
        self.assertGreater(heads[0].published, 1_700_000_000)  # timestamp parsed

    def test_parse_atom_entries_with_namespace(self):
        heads = v.NewsFeed().parse_rss(ATOM_SAMPLE, "Fed", "news")
        self.assertEqual(len(heads), 1)
        self.assertEqual(heads[0].title, "Fed signals pause on rate hikes")
        self.assertEqual(heads[0].link, "https://example.com/c")

    def test_broken_xml_returns_empty_not_raise(self):
        self.assertEqual(v.NewsFeed().parse_rss("<rss><channel><item>", "x"), [])

    def test_candidates_are_binary_with_criteria_and_manual_settlement(self):
        class FakeNews(v.NewsFeed):
            def headlines(self, limit_per_feed=6):
                return [v.Headline("SEC approves spot ETH ETF - CoinDesk", "https://x", "CoinDesk",
                                   time.time(), "news")]

        now = int(time.time())
        cands = FakeNews().candidates(now, 24, limit=1)
        self.assertEqual(len(cands), 1)
        c = cands[0]
        self.assertTrue(c.question.endswith("?"))
        self.assertIn("Will", c.question)
        self.assertIn("official response", c.question)
        self.assertEqual(c.category, "news")
        self.assertEqual(c.verification, "manual")   # news is never auto-settled
        self.assertGreaterEqual(len(c.criteria), 12)
        self.assertIn("CoinDesk", c.criteria)
        self.assertGreater(c.resolution_time, now + 1800)
        self.assertEqual(c.payload["source"], "CoinDesk")

    def test_clip_subject_strips_site_suffix(self):
        self.assertEqual(v._clip_subject("Big news today - CoinDesk"), "Big news today")


class TestSportsFeed(unittest.TestCase):
    def test_parse_scoreboard_pre_and_post(self):
        evs = v.SportsFeed().parse_scoreboard(ESPN_SAMPLE, "basketball/nba", "NBA")
        self.assertEqual(len(evs), 2)
        self.assertEqual(evs[0].state, "pre")
        self.assertEqual(evs[0].home, "Los Angeles Lakers")
        self.assertEqual(evs[1].state, "post")
        self.assertEqual((evs[1].home_score, evs[1].away_score), (2, 1))  # dict-shaped score parses too

    def test_candidates_only_use_upcoming_matches_inside_window(self):
        feed = v.SportsFeed()

        def fake_events():
            return [
                v.SportEvent("basketball/nba", "NBA", "401", "Lakers", "Celtics",
                             int(time.time()) + 3600, "pre"),
                v.SportEvent("soccer/eng.1", "Premier League", "402", "Arsenal", "Chelsea",
                             int(time.time()) - 7200, "post", 2, 1),
                v.SportEvent("soccer/eng.1", "Premier League", "403", "Spurs", "Everton",
                             int(time.time()) + 40 * 3600, "pre"),      # inside the 48h window -> keep
                v.SportEvent("soccer/eng.1", "Premier League", "404", "Fulham", "Brentford",
                             int(time.time()) + 80 * 3600, "pre"),      # too far out -> drop
            ]

        feed.events = fake_events  # type: ignore[assignment]
        cands = feed.candidates(int(time.time()), 24, limit=5)
        self.assertEqual(len(cands), 2)   # the sports window is at least 48h
        c = cands[0]
        self.assertEqual(c.category, "sports")
        self.assertEqual(c.verification, "auto")
        self.assertIn("Will", c.question)
        self.assertIn("beat", c.question)
        self.assertTrue(c.question.endswith("?"))
        self.assertIn("ESPN", c.criteria)
        self.assertIn("INVALID", c.criteria)
        self.assertEqual(c.payload["event_id"], "401")

    def test_winner_is_none_when_match_not_finished(self):
        class Feed(v.SportsFeed):
            def _get_json(self, url):
                return {"header": {"competitions": [{"status": {"type": {"state": "in"}},
                                                     "competitors": [
                                                         {"homeAway": "home", "score": "88"},
                                                         {"homeAway": "away", "score": "90"}]}]}}

        self.assertIsNone(Feed().winner("basketball/nba", "401"))

    def test_winner_reads_final_score(self):
        class Feed(v.SportsFeed):
            def _get_json(self, url):
                return {"header": {"competitions": [{"status": {"type": {"state": "post"}},
                                                     "competitors": [
                                                         {"homeAway": "home", "score": "101"},
                                                         {"homeAway": "away", "score": "98"}]}]}}

        self.assertEqual(Feed().winner("basketball/nba", "401"), "home")


class TestEsportsFeed(unittest.TestCase):
    def test_parse_schedule(self):
        ms = v.EsportsFeed().parse_schedule(LOL_SAMPLE)
        self.assertEqual(len(ms), 2)
        self.assertEqual(ms[0].team_a, "T1")
        self.assertEqual(ms[1].wins_a, 3)
        self.assertEqual(ms[1].state, "completed")

    def test_winner_returns_side_or_none(self):
        feed = v.EsportsFeed()
        feed.matches = lambda: feed.parse_schedule(LOL_SAMPLE)  # type: ignore[assignment]
        self.assertIsNone(feed.winner("m1"))   # not started
        self.assertEqual(feed.winner("m2"), "a")

    def test_candidates_binary_and_auto(self):
        feed = v.EsportsFeed()
        feed.matches = lambda: feed.parse_schedule(LOL_SAMPLE)  # type: ignore[assignment]
        cands = feed.candidates(int(time.time()), 48, limit=2)
        self.assertEqual(len(cands), 1)
        self.assertEqual(cands[0].verification, "auto")
        self.assertIn("Will", cands[0].question)
        self.assertIn("LoL Esports", cands[0].criteria)


class TestPlannerAndFingerprint(unittest.TestCase):
    def test_rotation_starts_at_cursor_and_wraps(self):
        self.assertEqual(v.VerticalPlanner.rotation(0, ("a", "b", "c")), ("a", "b", "c"))
        self.assertEqual(v.VerticalPlanner.rotation(1, ("a", "b", "c")), ("b", "c", "a"))
        self.assertEqual(v.VerticalPlanner.rotation(5, ("a", "b", "c")), ("c", "a", "b"))
        self.assertEqual(v.VerticalPlanner.rotation(0, ()), ())

    def test_fingerprint_is_stable_within_half_hour_window(self):
        now = 1_800_000_000
        a = v.VerticalCandidate("sports", "Will Team A win?", "criteria long enough", "sports", now, "auto", {})
        b = v.VerticalCandidate("sports", "Will Team A win?", "criteria long enough", "sports", now + 60, "auto", {})
        c = v.VerticalCandidate("sports", "Will Team A win?", "criteria long enough", "sports", now + 3600, "auto", {})
        self.assertEqual(a.fingerprint(), b.fingerprint())
        self.assertNotEqual(a.fingerprint(), c.fingerprint())

    def test_plan_dispatches_by_vertical(self):
        planner = v.VerticalPlanner()
        planner.news = type("N", (), {"candidates": lambda self, now, h, limit=1: ["news!"]})()
        self.assertEqual(planner.plan("news", 1, 1), ["news!"])
        self.assertEqual(planner.plan("crypto", 1, 1), [])  # crypto is the CreatorEngine's job


class TestBrainIntegration(unittest.TestCase):
    """Confirm the new verticals really plug into CreatorEngine / OracleEngine."""

    class FakeChain:
        def __init__(self, now: int):
            self.now = now
            self.sent: list[tuple] = []

        def block_timestamp(self):
            return self.now

        def keccak(self, text):
            return "0x" + (text.encode().hex()[:64]).ljust(64, "0")

        def send(self, sig, *args):
            self.sent.append((sig, args))
            return "0xtx"

        def usdc_balance(self, addr):
            return 10_000 * 10**6

        def ensure_allowance(self, amount):
            return None

        def address(self):
            return "0xwallet"

    def _creator(self, verticals=("news",)):
        now = int(time.time())
        chain = self.FakeChain(now)
        state = hb.State()

        class Planner:
            def plan(self, vertical, now, horizon_h, limit=1):
                return [v.VerticalCandidate(
                    vertical="news",
                    question="Will Acme Corp issue an official response within 24 hours?",
                    criteria="Settled from CoinDesk reporting before the resolution time; an official statement resolves YES.",
                    category="news", resolution_time=now + 24 * 3600,
                    verification="manual", payload={"source": "CoinDesk", "kind": "manual"},
                )]

        eng = hb.CreatorEngine(chain, None, state, __import__("pathlib").Path(tempfile.mkdtemp())/"outbox",
                               100.0, 24, False, planner=Planner(), verticals=verticals,
                               create_per_cycle=1)
        return eng, chain, state

    def test_creator_records_vertical_criteria_and_payload(self):
        eng, chain, state = self._creator()
        created = eng.run()
        self.assertEqual(len(created), 1)
        rec = next(iter(state.markets.values()))
        self.assertEqual(rec.vertical, "news")
        self.assertEqual(rec.verification, "manual")
        self.assertIn("CoinDesk", rec.criteria)
        self.assertTrue(rec.question.startswith("Will"))
        self.assertTrue(rec.question.endswith("?"))
        self.assertEqual(rec.payload["source"], "CoinDesk")
        sigs = [s for s, _ in chain.sent]
        self.assertIn("createMarketWithMeta(bytes32,string,string,uint256)", sigs)
        self.assertIn("seedLiquidity(bytes32,uint256)", sigs)

    def test_creator_with_no_usdc_logs_plans_but_creates_nothing(self):
        eng, chain, state = self._creator()
        chain.usdc_balance = lambda addr: 0          # empty wallet
        created = eng.run()
        self.assertEqual(created, [])
        self.assertEqual(state.markets, {})          # nothing may be created
        self.assertEqual(chain.sent, [])             # not a single transaction may be sent

    def test_creator_skips_duplicate_candidate(self):
        eng, _chain, _state = self._creator()
        eng.run()
        self.assertEqual(eng.run(), [])  # same question in the same window is not re-created

    def test_oracle_never_auto_settles_manual_news(self):
        now = int(time.time())
        rec = hb.MarketRecord(
            market_id="0x" + "11" * 32, symbol="",
            question="Will there be an official response to the incident within 24 hours?",
            category="news", threshold=0.0, direction="above", created_at=now - 7200,
            resolution_time=now - 60, seed_usdc=100.0, vertical="news",
            verification="manual", criteria="manual verification by the Safe", payload={"kind": "manual"},
        )

        class NullChain:
            def block_timestamp(self_inner):
                return now

            def send(self_inner, *a, **k):
                raise AssertionError("manual market must not be settled by the brain")

        eng = hb.OracleEngine(NullChain(), None, hb.State({rec.market_id: rec}),
                              __import__("pathlib").Path(tempfile.mkdtemp())/"proposals", False, True,
                              confirm_samples=1, confirm_gap_s=0)
        action, outcome, reason = eng._decide(rec)
        self.assertEqual((action, outcome), ("keep", None))
        self.assertIn("manual", reason)

    def test_oracle_settles_sports_from_final_score(self):
        now = int(time.time())
        rec = hb.MarketRecord(
            market_id="0x" + "22" * 32, symbol="", question="Will the Lakers beat the Celtics?",
            category="sports", threshold=0.0, direction="above", created_at=now - 7200,
            resolution_time=now - 60, seed_usdc=100.0, vertical="sports",
            verification="auto", criteria="settled on the ESPN final score",
            payload={"kind": "espn", "league": "basketball/nba", "event_id": "401",
                     "home": "Lakers", "away": "Celtics"},
        )

        class FakeSports:
            def winner(self, league, event_id):
                return "home"

        class NullChain:
            def block_timestamp(self_inner):
                return now

        eng = hb.OracleEngine(NullChain(), None, hb.State({rec.market_id: rec}),
                              __import__("pathlib").Path(tempfile.mkdtemp())/"proposals", False, True,
                              confirm_samples=1, confirm_gap_s=0, sports=FakeSports())
        action, outcome, reason = eng._decide(rec)
        self.assertEqual((action, outcome), ("resolve", hb.OUTCOME_YES))
        self.assertIn("ESPN", reason)

    def test_oracle_waits_when_score_not_final(self):
        now = int(time.time())
        rec = hb.MarketRecord(
            market_id="0x" + "33" * 32, symbol="", question="Will the Lakers beat the Celtics?",
            category="sports", threshold=0.0, direction="above", created_at=now - 7200,
            resolution_time=now - 60, seed_usdc=100.0, vertical="sports",
            verification="auto", criteria="settled on the ESPN final score",
            payload={"kind": "espn", "league": "basketball/nba", "event_id": "401"},
        )

        class FakeSports:
            def winner(self, league, event_id):
                return None

        class NullChain:
            def block_timestamp(self_inner):
                return now

        eng = hb.OracleEngine(NullChain(), None, hb.State({rec.market_id: rec}),
                              __import__("pathlib").Path(tempfile.mkdtemp())/"proposals", False, True,
                              confirm_samples=1, confirm_gap_s=0, sports=FakeSports())
        action, outcome, _ = eng._decide(rec)
        self.assertEqual((action, outcome), ("skip", None))


if __name__ == "__main__":
    unittest.main(verbosity=2)
