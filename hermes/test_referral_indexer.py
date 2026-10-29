#!/usr/bin/env python3
"""
hermes/test_referral_indexer.py -- offline unit tests for the affiliate indexer
(no chain, no network: the RPC surface is not touched here, only the decoding and
calldata-building logic that decides who gets paid how much).

Run:
    cd hermes && python3 -m unittest -v test_referral_indexer.py
"""
from __future__ import annotations

import unittest

import referral_indexer as ri

try:  # optional: only the re-derivation cross-check needs it
    from eth_utils import keccak as _keccak
except Exception:  # pragma: no cover - a bare install is the supported runtime
    _keccak = None

MARKET = "0x" + "11" * 32
BUYER = "0x" + "ab" * 20
REFERRER = "0x" + "cd" * 20


def _word(value: int) -> str:
    return format(value, "x").rjust(64, "0")


# signature -> pinned topic, so these fixtures need no crypto dependency at runtime
TOPIC_FOR = {ri.SIG_BOUGHT: ri.TOPIC_BOUGHT, ri.SIG_SOLD: ri.TOPIC_SOLD}


def _log(signature: str, values: list[int], trader: str = BUYER) -> dict:
    data = "0x" + "".join(_word(v) for v in values)
    return {
        "address": ri.ENGINE_DEFAULT,
        "topics": [TOPIC_FOR[signature], MARKET, "0x" + trader[2:].rjust(64, "0")],
        "data": data,
        "transactionHash": "0x" + "ef" * 32,
        "blockNumber": "0x10",
    }


def _tagged_input(referrer: str = REFERRER) -> str:
    order = "0x" + "a9" * 4 + _word(1) * 4
    return order + ri.REF_MAGIC.hex() + referrer[2:]


class TagTests(unittest.TestCase):
    def test_recovers_referrer_from_tagged_order(self):
        self.assertEqual(ri.parse_referrer(_tagged_input()), REFERRER)

    def test_untagged_order_returns_none(self):
        plain = "0x" + "a9" * 4 + _word(1) * 4
        self.assertIsNone(ri.parse_referrer(plain))

    def test_short_input_returns_none(self):
        self.assertIsNone(ri.parse_referrer("0x1234"))

    def test_magic_must_match(self):
        # an order that merely ends in an address is not attributed: the magic prefix is required
        tagged = _tagged_input()
        broken = tagged[: -56] + "00" * 8 + tagged[-40:]
        self.assertIsNone(ri.parse_referrer(broken))

    def test_zero_address_is_not_a_referrer(self):
        self.assertIsNone(ri.parse_referrer(_tagged_input("0x" + "00" * 20)))


class DecodeTests(unittest.TestCase):
    def test_buy_volume_is_amount_in(self):
        log = _log(ri.SIG_BOUGHT, [1, 250_000_000, 3_750_000, 480_000_000, 500_000_000_000_000_000])
        trade = ri.decode_trade(log)
        self.assertIsNotNone(trade)
        self.assertEqual(trade["kind"], "buy")
        self.assertEqual(trade["outcome"], 1)
        self.assertEqual(trade["volume"], 250_000_000)
        self.assertEqual(trade["fee"], 3_750_000)
        self.assertEqual(trade["shares"], 480_000_000)

    def test_sell_volume_is_gross_proceeds(self):
        log = _log(ri.SIG_SOLD, [0, 400_000_000, 196_000_000, 3_000_000, 480_000_000_000_000_000])
        trade = ri.decode_trade(log)
        self.assertIsNotNone(trade)
        self.assertEqual(trade["kind"], "sell")
        self.assertEqual(trade["volume"], 199_000_000)

    def test_unknown_event_is_ignored(self):
        log = _log(ri.SIG_BOUGHT, [1, 1, 1, 1, 1])
        log["topics"][0] = "0x" + "00" * 32
        self.assertIsNone(ri.decode_trade(log))

    def test_truncated_data_is_ignored(self):
        log = _log(ri.SIG_BOUGHT, [1, 2])
        self.assertIsNone(ri.decode_trade(log))


class RebateTests(unittest.TestCase):
    def test_twenty_percent_of_the_fee(self):
        # 1,000 USDC traded -> 15 USDC fee (1.5%) -> 3 USDC rebate (20%)
        self.assertEqual(ri.rebate_for(1_000_000_000), 3_000_000)

    def test_dust_rounds_to_zero_rather_than_paying_one_unit(self):
        self.assertEqual(ri.rebate_for(1), 0)

    def test_higher_share_scales_linearly(self):
        self.assertEqual(ri.rebate_for(1_000_000_000, 4_000), 6_000_000)


class CalldataTests(unittest.TestCase):
    def test_accrue_calldata_layout(self):
        data = ri.accrue_calldata("0x" + "aa" * 32, REFERRER, 3_000_000)
        body = data[2:]
        self.assertEqual(len(body), 8 + 64 * 3)
        self.assertEqual("0x" + body[:8], "0x" + ri.SEL_ACCRUE)
        self.assertEqual(body[8:72], "aa" * 32)
        self.assertEqual(body[72:136], REFERRER[2:].rjust(64, "0"))
        self.assertEqual(int(body[136:200], 16), 3_000_000)

    def test_pinned_topics_match_foundry(self):
        # values produced by `cast keccak` / `cast sig` from the ABI, pinned so the worker needs
        # no crypto dependency at runtime
        self.assertEqual(
            ri.TOPIC_BOUGHT, "0xf21c4ac9a2ac6238a9a299dec03abcc164b74fa85e7d949380f9d657a08f5fa9"
        )
        self.assertEqual(
            ri.TOPIC_SOLD, "0xbd3359e97cfa42d22e4990274c9d107f729226723ce88917de14e1b1d6eab510"
        )
        self.assertEqual(ri.SEL_ACCRUE, "387886c7")

    @unittest.skipIf(_keccak is None, "eth_utils not installed: pinned values still validated by cast")
    def test_pinned_topics_are_recomputable(self):
        # independent re-derivation, so a hand-edited constant cannot slip through
        for signature, pinned in (
            (ri.SIG_BOUGHT, ri.TOPIC_BOUGHT),
            (ri.SIG_SOLD, ri.TOPIC_SOLD),
        ):
            self.assertEqual("0x" + _keccak(signature.encode()).hex(), pinned)
        self.assertEqual(_keccak(ri.SIG_ACCRUE.encode()).hex()[:8], ri.SEL_ACCRUE)


if __name__ == "__main__":
    unittest.main()
