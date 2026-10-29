#!/usr/bin/env python3
"""
hermes/test_brain.py -- offline unit tests for the brain (no chain, no network).

Run:
    cd hermes && python3 -m unittest -v test_brain.py
"""

from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path

import hermes_brain as hb


class TestNiceRound(unittest.TestCase):
    def test_rounds_to_human_numbers(self):
        self.assertEqual(hb.nice_round(103_847.28), 104_000)
        self.assertEqual(hb.nice_round(4_132.7), 4_150)
        self.assertEqual(hb.nice_round(187.4), 185)  # nearest multiple of 5
        self.assertEqual(hb.nice_round(7.123), 7.12)

    def test_never_returns_zero_for_positive_input(self):
        for x in (0.01, 1.0, 99.9, 12_345.6):
            self.assertGreater(hb.nice_round(x), 0)


class TestMarketingCopy(unittest.TestCase):
    def setUp(self):
        self.mk = hb.MarketingEngine(Path(tempfile.mkdtemp()), "https://predict.example.com", dry_run=True)
        self.market = {
            "market_id": "0x" + "ab" * 32,
            "symbol": "BTC",
            "question": "Will BTC close above 105,000?",
            "threshold": 105_000.0,
            "spot": 103_000.0,
            "seed_usdc": 500.0,
            "horizon_h": 24,
            "resolution_time": int(time.time()) + 86400,
        }

    def test_template_contains_link_and_no_fake_numbers(self):
        copy = self.mk.template_copy(self.market)
        self.assertIn("https://predict.example.com/m/0x", copy["link"])
        self.assertIn(copy["link"], copy["twitter"])
        self.assertIn("105,000", copy["twitter"])
        self.assertIn("103,000.00", copy["twitter"])
        self.assertLessEqual(len(copy["twitter"]), 600)  # the template stays reasonably short

    def test_publish_writes_outbox_file(self):
        copy = self.mk.publish(self.market)
        files = list((self.mk.outbox).glob("*.md"))
        self.assertEqual(len(files), 1)
        body = files[0].read_text(encoding="utf-8")
        self.assertIn("## Twitter", body)
        self.assertIn(copy["generated_by"], body)


class TestOracleDecision(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.rec = hb.MarketRecord(
            market_id="0x" + "cd" * 32,
            symbol="BTC",
            question="BTC above 100000?",
            category="crypto",
            threshold=100_000.0,
            direction="above",
            created_at=int(time.time()) - 90_000,
            resolution_time=int(time.time()) - 60,  # already due
            seed_usdc=100.0,
        )

    def _engine(self, quote_factory):
        class FakeFeed:
            def spot(self_inner, symbol, cg_id):  # noqa: N805
                return quote_factory()

        class NullChain:
            def send(self_inner, *a, **k):  # noqa: N805
                raise AssertionError("dry resolution must not send in these cases")

            def block_timestamp(self_inner):  # noqa: N805
                return int(time.time())

        state = hb.State(markets={self.rec.market_id: self.rec})
        return hb.OracleEngine(
            NullChain(), FakeFeed(), state, self.tmp / "proposals", False, True,
            confirm_samples=1, confirm_gap_s=0,
        )

    def test_resolves_yes_when_price_above_threshold(self):
        eng = self._engine(lambda: hb.Quote("BTC", 101_500.0, time.time(), "test"))
        action, outcome, reason = eng._decide(self.rec)
        self.assertEqual((action, outcome), ("resolve", hb.OUTCOME_YES))
        self.assertIn("101,500", reason)

    def test_resolves_no_when_price_below_threshold(self):
        eng = self._engine(lambda: hb.Quote("BTC", 98_000.0, time.time(), "test"))
        action, outcome, _ = eng._decide(self.rec)
        self.assertEqual((action, outcome), ("resolve", hb.OUTCOME_NO))

    def test_skips_when_feed_is_dead_but_not_yet_refundable(self):
        eng = self._engine(lambda: None)
        action, outcome, reason = eng._decide(self.rec)
        self.assertEqual(action, "skip")
        self.assertIsNone(outcome)
        self.assertIn("price feed unavailable", reason)

    def test_falls_back_to_refund_after_seven_days(self):
        old = hb.MarketRecord(**{**self.rec.__dict__, "resolution_time": int(time.time()) - 8 * 86400})
        eng = self._engine(lambda: None)
        action, outcome, _ = eng._decide(old)
        self.assertEqual((action, outcome), ("refund", hb.OUTCOME_INVALID))

    def test_stale_quote_is_not_used(self):
        eng = self._engine(lambda: hb.Quote("BTC", 150_000.0, time.time() - 3600, "test"))
        action, _, reason = eng._decide(self.rec)
        self.assertEqual(action, "skip")
        self.assertIn("stale quote", reason)

    def test_not_due_yet_is_left_alone(self):
        future = hb.MarketRecord(**{**self.rec.__dict__, "resolution_time": int(time.time()) + 600})
        eng = self._engine(lambda: hb.Quote("BTC", 150_000.0, time.time(), "test"))
        action, _, reason = eng._decide(future)
        self.assertEqual(action, "keep")
        self.assertIn("not due", reason)


class TestMultiSampleConfirmation(unittest.TestCase):
    """Wick protection: 3 consecutive samples (30s apart) must all agree before settling on-chain."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.rec = hb.MarketRecord(
            market_id="0x" + "aa" * 32,
            symbol="BTC",
            question="BTC above 100000?",
            category="crypto",
            threshold=100_000.0,
            direction="above",
            created_at=int(time.time()) - 90_000,
            resolution_time=int(time.time()) - 60,
            seed_usdc=100.0,
        )

    def _engine(self, prices, samples=3):
        calls = {"n": 0}

        class SeqFeed:
            def spot(self_inner, symbol, cg_id):  # noqa: N805
                idx = min(calls["n"], len(prices) - 1)
                calls["n"] += 1
                p = prices[idx]
                if p is None:
                    return None
                return hb.Quote("BTC", p, time.time(), "test")

        class NullChain:
            def send(self_inner, *a, **k):  # noqa: N805
                raise AssertionError("must not send in these cases")

            def block_timestamp(self_inner):  # noqa: N805
                return int(time.time())

        eng = hb.OracleEngine(
            NullChain(), SeqFeed(), hb.State(markets={self.rec.market_id: self.rec}),
            self.tmp / "p", False, True, confirm_samples=samples, confirm_gap_s=0,
        )
        return eng, calls

    def test_defaults_are_three_samples_thirty_seconds(self):
        eng = hb.OracleEngine(None, None, hb.State(markets={}), self.tmp, False, True)
        self.assertEqual(eng.confirm_samples, 3)
        self.assertEqual(eng.confirm_gap_s, 30)

    def test_three_agreeing_samples_resolve(self):
        eng, calls = self._engine([101_000.0, 101_200.0, 100_900.0])
        action, outcome, reason = eng._decide(self.rec)
        self.assertEqual((action, outcome), ("resolve", hb.OUTCOME_YES))
        self.assertEqual(calls["n"], 3, "must sample exactly 3 times")
        self.assertIn("3/3 confirmed", reason)

    def test_price_flip_inside_window_blocks_resolution(self):
        eng, _ = self._engine([101_000.0, 99_000.0, 101_000.0])
        action, outcome, reason = eng._decide(self.rec)
        self.assertEqual(action, "skip")
        self.assertIsNone(outcome)
        self.assertIn("flipped", reason)

    def test_single_late_flip_blocks_resolution(self):
        eng, _ = self._engine([101_000.0, 101_000.0, 99_999.0])
        action, _, reason = eng._decide(self.rec)
        self.assertEqual(action, "skip")
        self.assertIn("flipped", reason)

    def test_failed_sample_blocks_resolution(self):
        eng, calls = self._engine([101_000.0, None, 101_000.0])
        action, _, reason = eng._decide(self.rec)
        self.assertEqual(action, "skip")
        self.assertIn("unavailable", reason)
        self.assertEqual(calls["n"], 2, "stops at the first failed sample")

    def test_three_agreeing_lows_resolve_no(self):
        eng, _ = self._engine([98_000.0, 98_500.0, 97_800.0])
        action, outcome, _ = eng._decide(self.rec)
        self.assertEqual((action, outcome), ("resolve", hb.OUTCOME_NO))


class TestStatePersistence(unittest.TestCase):
    def test_roundtrip_and_atomic_save(self):
        tmp = Path(tempfile.mkdtemp()) / "state.json"
        rec = hb.MarketRecord(
            market_id="0x" + "ef" * 32, symbol="ETH", question="q", category="crypto",
            threshold=4_000.0, direction="above", created_at=1, resolution_time=2, seed_usdc=100.0,
        )
        st = hb.State(markets={rec.market_id: rec})
        st.save(tmp)
        again = hb.State.load(tmp)
        self.assertEqual(again.markets[rec.market_id].threshold, 4_000.0)
        self.assertFalse(tmp.with_suffix(".tmp").exists())

    def test_corrupted_state_does_not_crash(self):
        tmp = Path(tempfile.mkdtemp()) / "bad.json"
        tmp.write_text("{not json")
        st = hb.State.load(tmp)
        self.assertEqual(st.markets, {})


class TestChainParsing(unittest.TestCase):
    def test_market_core_parsing(self):
        payload = (
            "(1000000000, 1098500000, 1098500000, 0, 100000000, 1700000000, 1699900000, "
            "0x000000000000000000000000000000000000b07, 1, true, true)"
        )

        class FakeChain(hb.Chain):
            def __init__(self):
                super().__init__("http://x", "0xengine", None, True)

            def call(self, sig, *args):  # noqa: D401
                return payload

        c = FakeChain().core("0x" + "11" * 32)
        self.assertEqual(c["yes_reserve"], 1_000_000_000)
        self.assertEqual(c["cash"], 1_098_500_000)
        self.assertTrue(c["resolved"])
        self.assertEqual(c["outcome"], 1)
        self.assertTrue(c["exists"])
        self.assertEqual(c["creator"], "0x000000000000000000000000000000000000b07")


class TestAnnotatedCastOutput(unittest.TestCase):
    """cast renders large numbers as '1793128834 [1.793e9]'; parsing must survive that annotation."""

    def test_resolution_state_with_human_readable_suffix(self):
        payload = "(true, false, true, 0, 1793128834 [1.793e9], 17008113 [1.7e7])"

        class FakeChain(hb.Chain):
            def __init__(self):
                super().__init__("http://x", "0xengine", None, True)

            def call(self, sig, *args):
                return payload

        resolved, finalized, disputing, outcome, ends_at, owed = FakeChain().resolution_state("0x" + "11" * 32)
        self.assertTrue(resolved)
        self.assertFalse(finalized)
        self.assertTrue(disputing)
        self.assertEqual(outcome, 0)
        self.assertEqual(ends_at, 1793128834)
        self.assertEqual(owed, 17008113)

    def test_multiline_return_values(self):
        """cast returns one line per value for multiple returns; that must parse too."""
        payload = "true\nfalse\ntrue\n1\n1793223218 [1.793e9]\n0"

        class FakeChain(hb.Chain):
            def __init__(self):
                super().__init__("http://x", "0xengine", None, True)

            def call(self, sig, *args):
                return payload

        resolved, finalized, disputing, outcome, ends_at, owed = FakeChain().resolution_state("0x" + "33" * 32)
        self.assertEqual((resolved, finalized, disputing), (True, False, True))
        self.assertEqual((outcome, ends_at, owed), (1, 1793223218, 0))

    def test_market_core_with_human_readable_suffix(self):
        payload = (
            "(100000000 [1e8], 100000000 [1e8], 108865000 [1.088e8], 17008113 [1.7e7], "
            "9000000 [9e6], 1793003538 [1.793e9], 1792917138 [1.792e9], "
            "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266, 1, true, true)"
        )

        class FakeChain(hb.Chain):
            def __init__(self):
                super().__init__("http://x", "0xengine", None, True)

            def call(self, sig, *args):
                return payload

        c = FakeChain().core("0x" + "22" * 32)
        self.assertEqual(c["cash"], 108_865_000)
        self.assertEqual(c["resolution_time"], 1_793_003_538)
        self.assertEqual(c["outcome"], 1)
        self.assertTrue(c["resolved"])
        self.assertEqual(c["creator"], "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")


if __name__ == "__main__":
    unittest.main(verbosity=2)
