"""Attribution indexer worker.

The engine cannot know who referred a trade: attribution lives in the order metadata the frontend
attaches, so a keeper has to reconcile "this fill" with "this referrer" and write the result into
ReferralLedger. This module is that keeper.

Pipeline
--------
    queue (JSONL)            one line per candidate attribution
        {"tx_hash":"0x…","referrer":"0x…","trader":"0x…"}      trader optional
            │
            ├─ verify  ── eth_getTransactionReceipt → SharesBought / SharesSold logs
            │             the referrer is only accepted when the log's `buyer`/`seller`
            │             matches `trader` (when supplied) and the volume is non-zero
            │
            ├─ dedupe  ── trade id = sha3(tx_hash + log_index); already-credited ids are skipped,
            │             and the contract rejects a repeat anyway (DuplicateTrade)
            │
            └─ accrue  ── dry-run by default: prints the exact call it *would* make.
                          --live signs with the operator key (never the treasury key) and sends.

Why dry-run is the default: this worker is meant to be run for days before a single USDC of pool
exists. Pointing it at mainnet with `--live` is a deliberate, one-flag decision.

Usage
-----
    # rehearsal against real Base state, nothing signed
    python3 hermes/indexer.py --queue ~/.aura/attribution.jsonl

    # fake one candidate end-to-end to show the pipeline works
    python3 hermes/indexer.py --mock-tx 0x…

    # production: broadcast accruals with the operator key
    python3 hermes/indexer.py --queue … --live --watch

Keys: the operator key is read from a file (default ~/.aura/indexer.key) and never printed.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

LEDGER = "0x2EbF3B69870979F863B8900f03CE8AcfE58E8954"
ENGINE = "0xE6056Bc6700F6d7E6fF8779B212655284dc1631C"
TRADE_FEE_BPS = 150  # mirrors CentralPredictionEngine.TRADE_FEE_BPS
DEFAULT_REBATE_BPS = 2000  # 20% of the fee, mirrors ReferralLedger.rebateBps
USDC = 1_000_000  # 6 decimals

TOPIC_BUY = "0xf21c4ac9a2ac6238a9a299dec03abcc164b74fa85e7d949380f9d657a08f5fa9"
TOPIC_SELL = "0xbd3359e97cfa42d22e4990274c9d107f729226723ce88917de14e1b1d6eab510"

ADDRESS_RE = r"^0x[0-9a-fA-F]{40}$"
TX_RE = r"^0x[0-9a-fA-F]{64}$"

CAST = os.environ.get("CAST_BIN", "/opt/foundry/cast")


class AttributionError(ValueError):
    """A queue line that cannot be credited as-is."""


@dataclass(frozen=True)
class Attribution:
    tx_hash: str
    referrer: str
    trader: str | None = None

    @staticmethod
    def parse(raw: dict[str, Any]) -> "Attribution":
        tx = str(raw.get("tx_hash", "")).strip()
        ref = str(raw.get("referrer", "")).strip()
        trader = raw.get("trader")
        trader = str(trader).strip() if trader else None
        if not _re_match(TX_RE, tx):
            raise AttributionError(f"bad tx_hash: {tx[:12]}")
        if not _re_match(ADDRESS_RE, ref):
            raise AttributionError(f"bad referrer: {ref[:12]}")
        if int(ref, 16) == 0:
            raise AttributionError("referrer is the zero address")
        if trader is not None and not _re_match(ADDRESS_RE, trader):
            raise AttributionError(f"bad trader: {trader[:12]}")
        return Attribution(tx_hash=tx.lower(), referrer=ref.lower(), trader=trader.lower() if trader else None)


def _re_match(pattern: str, value: str) -> bool:
    import re

    return re.match(pattern, value) is not None


def rebate_for(volume: int, rebate_bps: int = DEFAULT_REBATE_BPS) -> int:
    """Rebate in USDC base units, same integer maths as ReferralLedger.accrue (one division)."""
    if volume <= 0:
        return 0
    return volume * TRADE_FEE_BPS * rebate_bps // (10_000 * 10_000)


def trade_id(tx_hash: str, log_index: int) -> str:
    """Deterministic bytes32 id per fill — the ledger's dedupe key."""
    import hashlib

    digest = hashlib.sha3_256(f"{tx_hash.lower()}:{log_index}".encode()).digest()
    return "0x" + digest.hex()


def parse_fill(receipt: dict[str, Any], attribution: Attribution, engine: str = ENGINE) -> tuple[int, int]:
    """Return (log_index, volume_base_units) for the fill that matches this attribution.

    Raises AttributionError when the receipt holds no engine fill, when the fill's trader does not
    match the attributed trader, or when the volume is zero.
    """
    logs = receipt.get("logs") or []
    for log in logs:
        if str(log.get("address", "")).lower() != engine.lower():
            continue
        topics = [str(t).lower() for t in (log.get("topics") or [])]
        if not topics:
            continue
        kind = topics[0]
        if kind not in (TOPIC_BUY, TOPIC_SELL):
            continue
        if len(topics) < 3:
            continue
        who = "0x" + topics[2][-40:]
        if attribution.trader and who.lower() != attribution.trader.lower():
            continue
        words = [str(log.get("data", ""))[i : i + 64] for i in range(2, len(str(log.get("data", ""))), 64)]
        if len(words) < 5:
            continue
        idx = int(str(log.get("logIndex", "0x0")), 16)
        if kind == TOPIC_BUY:
            volume = int(words[1], 16)  # (outcome, amountIn, fee, sharesOut, priceYes)
        else:
            volume = int(words[3], 16)  # (outcome, sharesIn, fee, amountOut, priceYes)
        if volume <= 0:
            raise AttributionError("fill volume is zero")
        return idx, volume
    raise AttributionError(
        "no matching engine fill in this receipt"
        + (" (trader mismatch)" if attribution.trader else "")
    )


def load_queue(path: str) -> list[Attribution]:
    items: list[Attribution] = []
    if not os.path.exists(path):
        return items
    with open(path, encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                items.append(Attribution.parse(json.loads(line)))
            except (json.JSONDecodeError, AttributionError) as exc:
                print(f"skip line {lineno}: {exc}", file=sys.stderr)
    return items


def rpc(url: str, method: str, params: list[Any], timeout: float = 20.0) -> Any:
    """Minimal JSON-RPC over http.client with proxies disabled (WSL egress proxies break RPC)."""
    import http.client
    import ssl
    import urllib.parse

    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or "localhost"
    if parsed.scheme == "https":
        conn = http.client.HTTPSConnection(host, parsed.port, timeout=timeout,
                                           context=ssl.create_default_context())
    else:
        conn = http.client.HTTPConnection(host, parsed.port, timeout=timeout)
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    try:
        conn.request("POST", parsed.path or "/", body, {"content-type": "application/json"})
        payload = json.loads(conn.getresponse().read().decode())
    finally:
        conn.close()
    if "error" in payload:
        raise RuntimeError(payload["error"])
    return payload.get("result")


def fetch_receipt(url: str, tx_hash: str) -> dict[str, Any]:
    receipt = rpc(url, "eth_getTransactionReceipt", [tx_hash])
    if not receipt:
        raise AttributionError(f"tx not found or not mined: {tx_hash[:12]}")
    return receipt


REF_MAGIC = "6175726172656631"  # ascii "auraref1", mirrors frontend REF_MAGIC


def tag_of(input_hex: str) -> str | None:
    """Recover the referrer from a tagged order's calldata (last 28 bytes: magic + address)."""
    clean = (input_hex or "").lower()
    if clean.startswith("0x"):
        clean = clean[2:]
    if len(clean) < 56:
        return None
    tail = clean[-56:]
    if not tail.startswith(REF_MAGIC):
        return None
    addr = "0x" + tail[16:]
    if not _re_match(ADDRESS_RE, addr) or int(addr, 16) == 0:
        return None
    return addr.lower()


def fetch_tx(url: str, tx_hash: str) -> dict[str, Any]:
    tx = rpc(url, "eth_getTransactionByHash", [tx_hash])
    if not tx:
        raise AttributionError(f"tx not found: {tx_hash[:12]}")
    return tx


def scan_blocks(url: str, lookback: int, engine: str = ENGINE) -> list[Attribution]:
    """Walk the last `lookback` blocks and turn tagged engine calls into attribution candidates.

    This is the autonomous path: no queue, no client cooperation beyond the tag the frontend already
    writes into the order calldata. Untagged calls are ignored — there is no referrer to credit.
    """
    head = int(rpc(url, "eth_blockNumber", []), 16)
    found: list[Attribution] = []
    for height in range(head, max(head - lookback, 0) - 1, -1):
        block = rpc(url, "eth_getBlockByNumber", [hex(height), True])
        if not block:
            continue
        for tx in block.get("transactions") or []:
            if not isinstance(tx, dict):
                continue
            if str(tx.get("to") or "").lower() != engine.lower():
                continue
            referrer = tag_of(str(tx.get("input") or ""))
            if not referrer:
                continue
            trader = str(tx.get("from") or "").lower()
            if not _re_match(ADDRESS_RE, trader):
                continue
            found.append(Attribution(tx_hash=str(tx["hash"]).lower(), referrer=referrer, trader=trader))
    return found


def plan(attribution: Attribution, volume: int, log_index: int, rebate_bps: int = DEFAULT_REBATE_BPS) -> dict[str, Any]:
    rebate = rebate_for(volume, rebate_bps)
    if rebate <= 0:
        raise AttributionError("rebate rounds to zero — volume too small to credit")
    return {
        "trade_id": trade_id(attribution.tx_hash, log_index),
        "referrer": attribution.referrer,
        "volume": volume,
        "rebate": rebate,
    }


def verify_tag(url: str, attribution: Attribution) -> Attribution:
    """The calldata tag is authoritative: a queue line that disagrees with it is a bad claim."""
    tx = fetch_tx(url, attribution.tx_hash)
    tag = tag_of(str(tx.get("input") or ""))
    if tag is None:
        raise AttributionError("order carries no referral tag")
    if tag != attribution.referrer:
        raise AttributionError("queue referrer disagrees with the on-chain tag")
    sender = str(tx.get("from") or "").lower()
    if attribution.trader and sender != attribution.trader:
        raise AttributionError("queue trader disagrees with the transaction sender")
    return Attribution(tx_hash=attribution.tx_hash, referrer=tag, trader=sender)


def send_accrual(plan_item: dict[str, Any], operator_key_file: str, rpc_url: str, ledger: str, live: bool) -> bool:
    """Dry-run prints the call; --live signs it with the operator key file."""
    args = [
        CAST, "send", ledger,
        "accrue(bytes32,address,uint256)",
        plan_item["trade_id"], plan_item["referrer"], str(plan_item["volume"]),
    ]
    if not live:
        print("  dry-run:", " ".join(args[1:]))
        return True
    with open(operator_key_file, encoding="utf-8") as fh:
        key = fh.read().strip()
    if not re_match_key(key):
        raise AttributionError("operator key file does not contain a 0x 32-byte key")
    env = {k: v for k, v in os.environ.items() if k.lower() not in ("http_proxy", "https_proxy", "all_proxy")}
    out = subprocess.run(args + ["--private-key", key, "--rpc-url", rpc_url, "--json"],
                         capture_output=True, text=True, env=env, timeout=120)
    if out.returncode != 0:
        print(f"  send failed: {out.stderr.strip()[:160]}", file=sys.stderr)
        return False
    receipt = json.loads(out.stdout)
    ok = str(receipt.get("status", "")) in ("0x1", "1")
    print(f"  sent {plan_item['trade_id'][:10]}… status={'ok' if ok else 'reverted'}")
    return ok


def re_match_key(key: str) -> bool:
    import re

    return re.fullmatch(r"0x[0-9a-fA-F]{64}", key) is not None


def run_once(queue_path: str, rpc_url: str, ledger: str, key_file: str, live: bool,
             credited: set[str] | None = None) -> tuple[int, int]:
    """Process the queue once. Returns (credited_count, skipped_count)."""
    credited = credited if credited is not None else set()
    done = skipped = 0
    for attribution in load_queue(queue_path):
        try:
            attribution = verify_tag(rpc_url, attribution)
            receipt = fetch_receipt(rpc_url, attribution.tx_hash)
            log_index, volume = parse_fill(receipt, attribution)
            item = plan(attribution, volume, log_index)
        except (AttributionError, RuntimeError) as exc:
            print(f"skip {attribution.tx_hash[:12]}…: {exc}", file=sys.stderr)
            skipped += 1
            continue
        if item["trade_id"] in credited:
            skipped += 1
            continue
        print(f"{attribution.tx_hash[:12]}… ref={attribution.referrer[:10]}… vol={volume / USDC:.6f} "
              f"rebate={item['rebate'] / USDC:.6f}")
        if send_accrual(item, key_file, rpc_url, ledger, live):
            credited.add(item["trade_id"])
            done += 1
        else:
            skipped += 1
    return done, skipped


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Attribution indexer worker (dry-run by default).")
    ap.add_argument("--queue", default=os.path.expanduser("~/.aura/attribution.jsonl"))
    ap.add_argument("--rpc", default=os.environ.get("BASE_RPC_URL", "https://mainnet.base.org"))
    ap.add_argument("--ledger", default=LEDGER)
    ap.add_argument("--operator-key", default=os.path.expanduser("~/.aura/indexer.key"))
    ap.add_argument("--rebate-bps", type=int, default=DEFAULT_REBATE_BPS)
    ap.add_argument("--live", action="store_true", help="broadcast accruals (default: print only)")
    ap.add_argument("--watch", action="store_true", help="poll the queue every --interval seconds")
    ap.add_argument("--interval", type=float, default=30.0)
    ap.add_argument("--mock-tx", help="rehearse with one real tx hash, ignoring the queue")
    ap.add_argument("--scan-blocks", type=int, metavar="N",
                    help="ignore the queue and scan the last N blocks for tagged engine calls")
    args = ap.parse_args(list(argv) if argv is not None else None)

    if args.mock_tx:
        if not _re_match(TX_RE, args.mock_tx):
            print("--mock-tx needs a 32-byte hash", file=sys.stderr)
            return 2
        attribution = Attribution(tx_hash=args.mock_tx.lower(), referrer="0x000000000000000000000000000000000000beef")
        try:
            receipt = fetch_receipt(args.rpc, attribution.tx_hash)
            log_index, volume = parse_fill(receipt, attribution)
            item = plan(attribution, volume, log_index, args.rebate_bps)
        except (AttributionError, RuntimeError) as exc:
            print(f"mock failed: {exc}", file=sys.stderr)
            return 1
        print(json.dumps(item, indent=2))
        return 0

    if args.scan_blocks:
        found = scan_blocks(args.rpc, args.scan_blocks, ENGINE)
        print(f"scan: {len(found)} tagged engine call(s) in the last {args.scan_blocks} blocks")
        for attribution in found:
            print(f"  {attribution.tx_hash[:12]}… ref={attribution.referrer[:10]}… trader={attribution.trader}")
        return 0

    credited: set[str] = set()
    while True:
        done, skipped = run_once(args.queue, args.rpc, args.ledger, args.operator_key, args.live, credited)
        print(f"cycle: credited={done} skipped={skipped} mode={'live' if args.live else 'dry-run'}")
        if not args.watch:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
