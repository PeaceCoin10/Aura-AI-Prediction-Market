"""Tests for the dynamic commentary engine (hermes/insights.py)."""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

import insights
from insights import Market, impact_cost, render, simulate_buy, tone_for


ROOT = Path(__file__).resolve().parent.parent


class ImpactMathTest(unittest.TestCase):
    def test_cost_moves_curve_to_target(self):
        depth, p0, p1 = 50_000.0, 0.40, 0.50
        cost = impact_cost(depth, p0, p1)
        self.assertGreater(cost, 0)
        # paying `cost` net must land the simulation on the target probability
        gross = cost / (1 - 0.015)
        _shares, p_after = simulate_buy(depth, p0, gross)
        self.assertAlmostEqual(p_after, p1, delta=0.01)

    def test_cost_grows_with_distance(self):
        near = impact_cost(50_000.0, 0.40, 0.45)
        far = impact_cost(50_000.0, 0.40, 0.80)
        self.assertGreater(far, near)

    def test_cost_scales_with_depth(self):
        small = impact_cost(10_000.0, 0.40, 0.50)
        large = impact_cost(100_000.0, 0.40, 0.50)
        self.assertAlmostEqual(large / small, 10.0, delta=0.001)

    def test_rejects_degenerate_inputs(self):
        for args in ((0.0, 0.4, 0.5), (1_000.0, 0.0, 0.5), (1_000.0, 0.4, 1.0)):
            with self.assertRaises(ValueError):
                impact_cost(*args)


class CommentaryTest(unittest.TestCase):
    def make(self, **kw) -> Market:
        base = dict(mid="btc-90k", question="BTC above 90k?", category="crypto",
                    prob=0.4123, depth=50_000.0, volume=120_000.0, hours_left=30.0,
                    mood=1, mood_title="ETF inflows continue")
        base.update(kw)
        return Market(**base)

    def test_numbers_appear_verbatim(self):
        text = render(self.make())
        self.assertIn("41.2%", text)
        self.assertIn("50,000", text)
        self.assertIn("120,000", text)
        self.assertIn("2.4x", text)  # turnover 120000/50000

    def test_delta_clause_uses_previous_snapshot(self):
        text = render(self.make(prob=0.41, prev_prob=0.45, prev_ts=1_700_000_000))
        self.assertIn("down 4.0 pts", text)

    def test_opening_snapshot_is_stated(self):
        text = render(self.make(prev_prob=None))
        self.assertIn("opening snapshot", text)

    def test_whale_clause_without_prints_is_honest(self):
        text = render(self.make(whale_prints=0))
        self.assertIn("no whale print", text)

    def test_whale_clause_reports_imbalance(self):
        text = render(self.make(whale_prints=7, whale_buy=180_000.0, whale_sell=40_000.0,
                                top_print=("SOLUSDT", 83_100.0, "buy")))
        self.assertIn("7 prints", text)
        self.assertIn("+$140,000", text)
        self.assertIn("bid-side", text)
        self.assertIn("83,100", text)

    def test_no_none_leaks_into_prose(self):
        self.assertNotIn("None", render(self.make()))
        self.assertNotIn("None", render(self.make(whale_prints=3, whale_buy=1.0, whale_sell=2.0)))

    def test_render_differs_across_markets(self):
        a = render(self.make(mid="a", prob=0.41, volume=120_000.0))
        b = render(self.make(mid="b", prob=0.78, volume=9_000.0, depth=12_000.0))
        self.assertNotEqual(a, b)


class ToneTest(unittest.TestCase):
    def test_extremes_are_warnings(self):
        self.assertEqual(tone_for(Market("m", "q", "crypto", 0.9, 10_000, 1_000, 10)), "warn")
        self.assertEqual(tone_for(Market("m", "q", "crypto", 0.1, 10_000, 1_000, 10)), "warn")

    def test_whale_direction_drives_tone(self):
        bull = Market("m", "q", "crypto", 0.55, 50_000, 20_000, 10, whale_buy=90_000, whale_sell=10_000, whale_prints=4, mood=1)
        bear = Market("m", "q", "crypto", 0.45, 50_000, 20_000, 10, whale_buy=10_000, whale_sell=90_000, whale_prints=4, mood=-1)
        self.assertEqual(tone_for(bull), "bull")
        self.assertEqual(tone_for(bear), "bear")


class CatalogueTest(unittest.TestCase):
    def test_reads_the_shipped_catalogue(self):
        rows = insights.load_catalogue(ROOT / "frontend" / "src" / "data" / "markets.ts")
        self.assertEqual(len(rows), 255)
        self.assertEqual(rows[0].mid, "btc-90k")
        self.assertTrue(all(0 < r.prob < 1 for r in rows))
        self.assertTrue(all(r.depth >= 0 for r in rows))

    def test_catalogue_entry_renders(self):
        rows = insights.load_catalogue(ROOT / "frontend" / "src" / "data" / "markets.ts")
        text = render(rows[0])
        self.assertIn("YES", text)
        self.assertTrue(any(ch.isdigit() for ch in text))


class LLMLayerTest(unittest.TestCase):
    def m(self, **kw) -> Market:
        base = dict(mid="btc-90k", question="Will BTC close above $90,000 this week?", category="crypto",
                    prob=0.42, depth=50_000.0, volume=182_400.0, hours_left=30.0,
                    mood=-3, mood_title="Binance says phase one of withdrawals opens after $6.3B hack")
        base.update(kw)
        return Market(**base)

    def test_prompt_carries_the_numbers_and_the_rules(self):
        msgs = insights.build_messages([self.m()], {"as_of": "2026-11-01T00:00:00Z",
                                                    "engine": "0xE605", "headlines": ["hack"]})
        self.assertEqual(msgs[0]["role"], "system")
        self.assertIn("Never invent", msgs[0]["content"])
        payload = msgs[1]["content"]
        self.assertIn("btc-90k", payload)
        self.assertIn('"prob_yes_pct": 42.0', payload)
        self.assertIn('"volume_usdc": 182400', payload)
        self.assertIn("90,000", payload)

    def good(self) -> dict:
        return {"items": [{"id": "btc-90k",
                           "text": ("YES 42.0% with 182,400 USDC traded against 50,000 of depth. The $6.3B "
                                    "hack headline is a risk channel, not a footnote: it argues for a lower "
                                    "price than the book shows, and the spread between that and 42.0% is the "
                                    "trade. Settlement needs the named close, so late flow decides it."),
                           "tone": "warn"}]}

    def test_validation_accepts_a_compliant_row(self):
        out = insights.validate_items(json.dumps(self.good()), [self.m()], ["$6.3B hack"])
        self.assertIn("btc-90k", out)
        self.assertEqual(out["btc-90k"]["tone"], "warn")

    def test_validation_rejects_a_hallucinated_number(self):
        bad = self.good()
        bad["items"][0]["text"] = bad["items"][0]["text"].replace("182,400", "412,900")
        out = insights.validate_items(json.dumps(bad), [self.m()], ["$6.3B hack"])
        self.assertEqual(out, {})

    def test_validation_rejects_missing_probability(self):
        bad = self.good()
        bad["items"][0]["text"] = "Momentum is turning and the tape looks heavy into settlement."
        self.assertEqual(insights.validate_items(json.dumps(bad), [self.m()], []), {})

    def test_validation_rejects_refusals(self):
        bad = self.good()
        bad["items"][0]["text"] = "As an AI I cannot give trading commentary on this market at all."
        self.assertEqual(insights.validate_items(json.dumps(bad), [self.m()], []), {})

    def test_generate_llm_batches_and_survives_a_failure(self):
        calls = []

        def fake(messages, **kw):
            calls.append(messages)
            if len(calls) == 1:
                return json.dumps(self.good())
            raise RuntimeError("boom")

        markets = [self.m(), self.m(mid="eth-4k", question="Will ETH close above $4,000?")]
        out = insights.generate_llm(markets, {"headlines": ["$6.3B hack"]}, chat_fn=fake, batch_size=1)
        self.assertEqual(len(calls), 2)
        self.assertIn("btc-90k", out)

    def test_generate_marks_source_and_falls_back(self):
        import tempfile, pathlib as _p
        cat = _p.Path(tempfile.mkdtemp()) / "markets.ts"
        rows = "".join(
            f'  ["m{i}", "crypto", "Will BTC close above $90,000? q{i}", "CoinGecko close.", "CoinGecko", '
            f'0.4, 50000, 2, 100000, "Crypto"],\n' for i in range(2)
        )
        cat.write_text('[\n' + rows + ']\n')

        def fake(messages, **kw):
            return json.dumps({"items": [
                {"id": "m0", "text": "YES 40.0% and 100,000 USDC traded against 50,000 of depth, "
                                     "with 48.0h to settlement on the named close.", "tone": "geek"},
            ]})

        with tempfile.TemporaryDirectory() as tmp:
            payload = insights.generate(_p.Path(tmp), _p.Path(tmp) / "out.json", "http://x", "0xE",
                                        catalogue=cat, whale=False, llm=True, chat_fn=fake)
        self.assertEqual(payload["items"]["m0"]["source"], "deepseek")
        self.assertEqual(payload["items"]["m1"]["source"], "computed")
        self.assertEqual(payload["llm"]["answered"], 1)


if __name__ == "__main__":
    unittest.main()
