"""Tests for the attribution indexer worker (hermes/indexer.py).

No network: receipts are synthetic but use the real event layout (2 indexed topics + 5 static
words), so the decoder is exercised on the same shape the engine emits.
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest

import indexer


def word(value: int) -> str:
    return f"{value:064x}"


def receipt(kind: str, trader: str, volume: int, log_index: int = 3, address: str | None = None) -> dict:
    topics = [kind, "0x" + word(42), "0x" + "0" * 24 + trader[2:].lower()]
    if kind == indexer.TOPIC_BUY:
        data = "0x" + word(1) + word(volume) + word(15_000_000) + word(2_393_000_000) + word(4 * 10**17)
    else:
        data = "0x" + word(1) + word(volume) + word(15_000_000) + word(volume) + word(4 * 10**17)
    return {
        "logs": [
            {
                "address": address or indexer.ENGINE,
                "topics": topics,
                "data": data,
                "logIndex": hex(log_index),
            }
        ]
    }


class RebateMath(unittest.TestCase):
    def test_matches_contract_formula(self):
        # 1,000 USDC volume -> 1.5% fee -> 20% of that = 3 USDC
        self.assertEqual(indexer.rebate_for(1_000 * indexer.USDC), 3 * indexer.USDC)

    def test_zero_and_negative_are_zero(self):
        self.assertEqual(indexer.rebate_for(0), 0)
        self.assertEqual(indexer.rebate_for(-5), 0)

    def test_floor_division_never_overpays(self):
        self.assertEqual(indexer.rebate_for(1), 0)
        self.assertEqual(indexer.rebate_for(333), 0)  # 333 base units -> 0.999 base units of rebate
        self.assertEqual(indexer.rebate_for(3_333), 9)  # floors, never rounds up


class Parsing(unittest.TestCase):
    def test_accepts_a_well_formed_line(self):
        a = indexer.Attribution.parse(
            {"tx_hash": "0x" + "ab" * 32, "referrer": "0x" + "11" * 20, "trader": "0x" + "22" * 20}
        )
        self.assertEqual(a.referrer, "0x" + "11" * 20)
        self.assertEqual(a.trader, "0x" + "22" * 20)

    def test_rejects_bad_hash_and_zero_referrer(self):
        with self.assertRaises(indexer.AttributionError):
            indexer.Attribution.parse({"tx_hash": "0x1234", "referrer": "0x" + "11" * 20})
        with self.assertRaises(indexer.AttributionError):
            indexer.Attribution.parse({"tx_hash": "0x" + "ab" * 32, "referrer": "0x" + "00" * 20})

    def test_rejects_bad_trader(self):
        with self.assertRaises(indexer.AttributionError):
            indexer.Attribution.parse(
                {"tx_hash": "0x" + "ab" * 32, "referrer": "0x" + "11" * 20, "trader": "0xabc"}
            )


class FillDecoding(unittest.TestCase):
    def setUp(self):
        self.trader = "0x" + "22" * 20
        self.attr = indexer.Attribution(tx_hash="0x" + "ab" * 32, referrer="0x" + "11" * 20, trader=self.trader)

    def test_buy_volume_is_amount_in(self):
        idx, volume = indexer.parse_fill(receipt(indexer.TOPIC_BUY, self.trader, 1_000 * indexer.USDC), self.attr)
        self.assertEqual(idx, 3)
        self.assertEqual(volume, 1_000 * indexer.USDC)

    def test_sell_volume_is_amount_out(self):
        idx, volume = indexer.parse_fill(receipt(indexer.TOPIC_SELL, self.trader, 250 * indexer.USDC), self.attr)
        self.assertEqual(volume, 250 * indexer.USDC)

    def test_trader_mismatch_is_not_credited(self):
        other = "0x" + "33" * 20
        with self.assertRaises(indexer.AttributionError):
            indexer.parse_fill(receipt(indexer.TOPIC_BUY, other, 1_000 * indexer.USDC), self.attr)

    def test_foreign_contract_logs_are_ignored(self):
        foreign = "0x" + "44" * 20
        with self.assertRaises(indexer.AttributionError):
            indexer.parse_fill(receipt(indexer.TOPIC_BUY, self.trader, 10**6, address=foreign), self.attr)


class Planning(unittest.TestCase):
    def setUp(self):
        self.attr = indexer.Attribution(tx_hash="0x" + "ab" * 32, referrer="0x" + "11" * 20)

    def test_trade_id_is_stable_and_per_fill(self):
        a = indexer.trade_id(self.attr.tx_hash, 1)
        self.assertEqual(a, indexer.trade_id(self.attr.tx_hash, 1))
        self.assertNotEqual(a, indexer.trade_id(self.attr.tx_hash, 2))
        self.assertEqual(len(a), 66)

    def test_plan_carries_rebate(self):
        item = indexer.plan(self.attr, 1_000 * indexer.USDC, 1)
        self.assertEqual(item["rebate"], 3 * indexer.USDC)
        self.assertEqual(item["referrer"], self.attr.referrer)

    def test_dust_volume_is_refused(self):
        with self.assertRaises(indexer.AttributionError):
            indexer.plan(self.attr, 100, 1)


class Queue(unittest.TestCase):
    def test_bad_lines_are_skipped_not_fatal(self):
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as fh:
            fh.write("# comment\n")
            fh.write(json.dumps({"tx_hash": "0x" + "ab" * 32, "referrer": "0x" + "11" * 20}) + "\n")
            fh.write("{not json}\n")
            fh.write(json.dumps({"tx_hash": "0x12", "referrer": "0x" + "11" * 20}) + "\n")
            path = fh.name
        try:
            items = indexer.load_queue(path)
        finally:
            os.unlink(path)
        self.assertEqual(len(items), 1)

    def test_missing_queue_is_empty(self):
        self.assertEqual(indexer.load_queue("/nonexistent/queue.jsonl"), [])


class DryRun(unittest.TestCase):
    def test_run_once_credits_without_broadcasting(self):
        trader = "0x" + "22" * 20
        line = {"tx_hash": "0x" + "ab" * 32, "referrer": "0x" + "11" * 20, "trader": trader}
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as fh:
            fh.write(json.dumps(line) + "\n")
            path = fh.name
        sent = []
        original_fetch, original_send, original_tx = indexer.fetch_receipt, indexer.send_accrual, indexer.fetch_tx
        tagged = "0x" + "ab" * 16 + indexer.REF_MAGIC + line["referrer"][2:]
        indexer.fetch_tx = lambda url, h: {"input": tagged, "from": trader}
        indexer.fetch_receipt = lambda url, tx: receipt(indexer.TOPIC_BUY, trader, 1_000 * indexer.USDC)
        indexer.send_accrual = lambda item, key, rpc, ledger, live: sent.append((item, live)) or True
        try:
            done, skipped = indexer.run_once(path, "http://x", indexer.LEDGER, "/nokey", live=False)
        finally:
            indexer.fetch_receipt, indexer.send_accrual, indexer.fetch_tx = original_fetch, original_send, original_tx
            os.unlink(path)
        self.assertEqual((done, skipped), (1, 0))
        self.assertEqual(sent[0][1], False)  # never live by accident

    def test_operator_key_format_is_enforced(self):
        self.assertTrue(indexer.re_match_key("0x" + "ab" * 32))
        self.assertFalse(indexer.re_match_key("0xdeadbeef"))
        self.assertFalse(indexer.re_match_key(""))




class OrderTag(unittest.TestCase):
    REF = "0x436b9d5e6fbd40ec93e881263be53e59f8755ba1"

    def test_tag_round_trip(self):
        tagged = "0x" + "ab" * 16 + indexer.REF_MAGIC + self.REF[2:]
        self.assertEqual(indexer.tag_of(tagged), self.REF)

    def test_untagged_and_zero_referrer_are_rejected(self):
        self.assertIsNone(indexer.tag_of("0x" + "ab" * 40))
        self.assertIsNone(indexer.tag_of(""))
        zero = "0x" + "ab" * 16 + indexer.REF_MAGIC + "00" * 20
        self.assertIsNone(indexer.tag_of(zero))

    def test_queue_disagreement_with_tag_is_refused(self):
        tagged = "0x" + "ab" * 16 + indexer.REF_MAGIC + self.REF[2:]
        tx = {"input": tagged, "from": "0x" + "22" * 20}
        original = indexer.fetch_tx
        indexer.fetch_tx = lambda url, h: tx
        try:
            good = indexer.Attribution(tx_hash="0x" + "cd" * 32, referrer=self.REF, trader="0x" + "22" * 20)
            self.assertEqual(indexer.verify_tag("http://x", good).referrer, self.REF)
            bad = indexer.Attribution(tx_hash="0x" + "cd" * 32, referrer="0x" + "99" * 20)
            with self.assertRaises(indexer.AttributionError):
                indexer.verify_tag("http://x", bad)
            no_tag = dict(tx)
            no_tag["input"] = "0xdeadbeef"
            indexer.fetch_tx = lambda url, h: no_tag
            with self.assertRaises(indexer.AttributionError):
                indexer.verify_tag("http://x", good)
        finally:
            indexer.fetch_tx = original

    def test_block_scan_finds_only_tagged_engine_calls(self):
        tagged = "0x" + "ab" * 16 + indexer.REF_MAGIC + self.REF[2:]
        block = {
            "transactions": [
                {"hash": "0x" + "10" * 32, "to": indexer.ENGINE, "from": "0x" + "22" * 20, "input": tagged},
                {"hash": "0x" + "11" * 32, "to": indexer.ENGINE, "from": "0x" + "22" * 20, "input": "0xdeadbeef"},
                {"hash": "0x" + "12" * 32, "to": "0x" + "77" * 20, "from": "0x" + "22" * 20, "input": tagged},
            ]
        }
        original = indexer.rpc

        def fake_rpc(url, method, params, timeout=20.0):
            if method == "eth_blockNumber":
                return hex(1000)
            if method == "eth_getBlockByNumber":
                return block if int(params[0], 16) == 1000 else {"transactions": []}
            raise AssertionError(method)

        indexer.rpc = fake_rpc
        try:
            found = indexer.scan_blocks("http://x", 2)
        finally:
            indexer.rpc = original
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].tx_hash, "0x" + "10" * 32)
        self.assertEqual(found[0].referrer, self.REF)


if __name__ == "__main__":
    unittest.main()
