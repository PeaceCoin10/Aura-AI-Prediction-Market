#!/usr/bin/env python3
"""Aura referral indexer.

Closes the affiliate loop. Every attributed order carries the referrer in the last 28 bytes of its
calldata (``"auraref1"`` || address). This worker walks the engine's trade events, recovers that
tag from the transaction input, and writes the accrued rebate into ``ReferralLedger`` as its
operator. From then on the referrer can pull the USDC from the dApp (or by calling ``claim()``).

Dry by default: it prints exactly what it would credit and writes a preview file. Pass ``--post``
to sign and broadcast. The operator key never leaves the process.

    python3 hermes/referral_indexer.py --dry-run --from-block 0
    python3 hermes/referral_indexer.py --post --ledger 0x...

Environment:
    REFERRAL_OPERATOR_KEY   operator private key (required only with --post)
    BASE_RPC_URL            RPC endpoint (default: https://mainnet.base.org)
"""
from __future__ import annotations

import argparse
import base64
import http.client
import json
import os
import ssl
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE_FILE = ROOT / "hermes-runtime" / "referral-indexer-state.json"
PREVIEW_FILE = ROOT / "hermes-runtime" / "referral-accrual-preview.json"

ENGINE_DEFAULT = "0xE6056Bc6700F6d7E6fF8779B212655284dc1631C"
CHUNK_DEFAULT = 500
LOOKBACK_BLOCKS = 10_000

# event signatures, hashed with keccak-256
SIG_BOUGHT = "SharesBought(bytes32,address,uint8,uint256,uint256,uint256,uint256)"
SIG_SOLD = "SharesSold(bytes32,address,uint8,uint256,uint256,uint256,uint256)"
SIG_ACCRUE = "accrue(bytes32,address,uint256)"

REF_MAGIC = b"auraref1"          # 8 bytes
REF_TAG_LEN = len(REF_MAGIC) + 20  # + address = 28 bytes
TRADE_FEE_BPS = 150               # 1.5%, mirrors the engine
REBATE_BPS_DEFAULT = 2000         # 20% of that fee, mirrors ReferralLedger


# --------------------------------------------------------------------------- RPC
def rpc(url: str, method: str, params: list, timeout: int = 30) -> object:
    """Minimal JSON-RPC over http.client.

    Deliberately not requests/urllib: the shell environment here exports HTTP proxies that break
    direct node access, and a referral settlement must talk to the chain, not to a proxy.
    """
    parsed = urllib.parse.urlparse(url)
    conn_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    path = parsed.path or "/"
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    host = parsed.hostname or "localhost"
    if parsed.scheme == "https":
        conn = conn_cls(host, parsed.port, timeout=timeout, context=ssl.create_default_context())
    else:
        conn = conn_cls(host, parsed.port, timeout=timeout)
    try:
        conn.request(
            "POST",
            path,
            body=body,
            headers={
                "content-type": "application/json",
                "authorization": _basic_auth(parsed),
            },
        )
        payload = json.loads(conn.getresponse().read().decode())
    finally:
        conn.close()
    if "error" in payload:
        raise RuntimeError(f"{method} failed: {payload['error']}")
    return payload["result"]


def _basic_auth(parsed: urllib.parse.ParseResult) -> str:
    if parsed.username and parsed.password:
        token = f"{parsed.username}:{parsed.password}".encode()
        return "Basic " + base64.b64encode(token).decode()
    return ""


# ------------------------------------------------------------------- pure helpers
def keccak_hex(data: str) -> str:
    from eth_utils import keccak

    return "0x" + keccak(hexstr=data).hex()


def topic0(signature: str) -> str:
    return keccak_hex("0x" + signature.encode().hex())


def parse_referrer(tx_input: str) -> str | None:
    """Recover the referrer address from a tagged order calldata, or None when untagged."""
    raw = bytes.fromhex(tx_input[2:] if tx_input.startswith("0x") else tx_input)
    if len(raw) < len(REF_MAGIC) + 20:
        return None
    tail = raw[-REF_TAG_LEN:]
    if tail[: len(REF_MAGIC)] != REF_MAGIC:
        return None
    address = tail[len(REF_MAGIC) :]
    if len(address) != 20 or not any(address):
        return None
    return "0x" + address.hex()


def _words(data_hex: str) -> list[int]:
    raw = bytes.fromhex(data_hex[2:] if data_hex.startswith("0x") else data_hex)
    return [int.from_bytes(raw[i : i + 32], "big") for i in range(0, len(raw) - 31, 32)]


def decode_trade(log: dict) -> dict | None:
    """Decode a SharesBought / SharesSold log into the fields the ledger needs."""
    topics = [t.lower() for t in log.get("topics", [])]
    if not topics:
        return None
    t0 = topics[0]
    words = _words(log.get("data", "0x"))
    if t0 == topic0(SIG_BOUGHT):
        if len(words) < 5:
            return None
        kind, outcome, amount_in, fee, shares, price = "buy", words[0], words[1], words[2], words[3], words[4]
        return {"kind": kind, "outcome": outcome, "volume": amount_in, "fee": fee, "shares": shares, "priceYes": price}
    if t0 == topic0(SIG_SOLD):
        if len(words) < 5:
            return None
        kind, outcome, shares_in, amount_out, fee, price = "sell", words[0], words[1], words[2], words[3], words[4]
        # gross volume of a sell is what left the pool before the fee was taken
        return {"kind": kind, "outcome": outcome, "volume": amount_out + fee, "fee": fee, "shares": shares_in, "priceYes": price}
    return None


def rebate_for(volume: int, rebate_bps: int = REBATE_BPS_DEFAULT) -> int:
    return volume * TRADE_FEE_BPS * rebate_bps // (10_000 * 10_000)


def accrue_calldata(trade_id_hex: str, referrer: str, volume: int) -> str:
    selector = keccak_hex("0x" + SIG_ACCRUE.encode().hex())[2:][:8]
    tid = trade_id_hex[2:] if trade_id_hex.startswith("0x") else trade_id_hex
    tid = tid.rjust(64, "0")
    return "0x" + selector + tid + referrer[2:].lower().rjust(64, "0") + format(volume, "x").rjust(64, "0")


# ------------------------------------------------------------------------- index
def collect(rpc_url: str, engine: str, from_block: int, to_block: int, chunk: int) -> list[dict]:
    """Every trade between two blocks that carries a referral tag."""
    topics = [topic0(SIG_BOUGHT), topic0(SIG_SOLD)]
    found: list[dict] = []
    block = from_block
    window = max(chunk, 1)
    while block <= to_block:
        end = min(block + window - 1, to_block)
        query = {"address": engine, "fromBlock": hex(block), "toBlock": hex(end), "topics": [topics]}
        try:
            logs = rpc(rpc_url, "eth_getLogs", [query])
        except RuntimeError:
            # public endpoints cap the block span (and the log count): halve and retry, down to 25
            if window > 25:
                window = max(window // 2, 25)
                continue
            raise
        if len(logs) >= 9_000 and window > 25:
            # too close to the provider's result cap to be sure the range is complete
            window = max(window // 2, 25)
            continue
        for log in logs:
            trade = decode_trade(log)
            if not trade:
                continue
            tx = rpc(rpc_url, "eth_getTransactionByHash", [log["transactionHash"]])
            if not tx:
                continue
            referrer = parse_referrer(tx.get("input", "0x"))
            if not referrer:
                continue
            trade.update(
                {
                    "txHash": log["transactionHash"],
                    "tradeId": log["transactionHash"],
                    "referrer": referrer,
                    "trader": "0x" + log["topics"][2][-40:],
                    "block": int(log["blockNumber"], 16),
                    "rebate": rebate_for(trade["volume"]),
                }
            )
            if trade["rebate"] > 0:
                found.append(trade)
        block = end + 1
    return found


def load_state() -> int | None:
    try:
        return int(json.loads(STATE_FILE.read_text())["lastBlock"])
    except Exception:
        return None


def save_state(block: int) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"lastBlock": block}, indent=2))


def post_accruals(items: list[dict], rpc_url: str, ledger: str, key: str) -> list[str]:
    """Sign and broadcast one accrue() per item; returns the tx hashes."""
    from eth_account import Account

    account = Account.from_key(key)
    hashes: list[str] = []
    for item in items:
        tx = {
            "to": ledger,
            "data": accrue_calldata(item["tradeId"], item["referrer"], item["volume"]),
            "value": 0,
            "gas": 200_000,
            "maxFeePerGas": int(rpc(rpc_url, "eth_gasPrice", []), 16) * 2,
            "maxPriorityFeePerGas": int(rpc(rpc_url, "eth_maxPriorityFeePerGas", []), 16),
            "nonce": int(rpc(rpc_url, "eth_getTransactionCount", [account.address, "pending"]), 16),
            "chainId": int(rpc(rpc_url, "eth_chainId", []), 16),
        }
        signed = account.sign_transaction(tx)
        raw = signed.raw_transaction.hex()
        if not raw.startswith("0x"):
            raw = "0x" + raw
        hashes.append(str(rpc(rpc_url, "eth_sendRawTransaction", [raw])))
    return hashes


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Accrue affiliate rebates for tagged Aura trades")
    ap.add_argument("--rpc-url", default=os.environ.get("BASE_RPC_URL", "https://base-rpc.publicnode.com"))
    ap.add_argument("--engine", default=os.environ.get("ENGINE_ADDRESS", ENGINE_DEFAULT))
    ap.add_argument("--ledger", default=os.environ.get("REFERRAL_LEDGER", ""))
    ap.add_argument("--from-block", type=int, default=None)
    ap.add_argument("--to-block", type=int, default=None)
    ap.add_argument("--chunk", type=int, default=CHUNK_DEFAULT)
    ap.add_argument("--post", action="store_true", help="sign and broadcast (default: dry run)")
    args = ap.parse_args(argv)

    latest = int(rpc(args.rpc_url, "eth_blockNumber", []), 16)
    # without state, look back a bounded window: a full-history scan belongs on an archive provider
    fallback = max(0, latest - LOOKBACK_BLOCKS)
    start = args.from_block if args.from_block is not None else (load_state() or fallback)
    end = args.to_block if args.to_block is not None else latest
    if start > end:
        print(f"nothing to do: state is at block {start}, chain head is {end}")
        return 0

    items = collect(args.rpc_url, args.engine, start, end, args.chunk)
    total = sum(i["rebate"] for i in items)

    PREVIEW_FILE.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW_FILE.write_text(json.dumps(items, indent=2))

    print(f"blocks {start}..{end} | tagged trades: {len(items)} | rebate: {total / 1e6:.6f} USDC")
    for i in items:
        print(
            f"  {i['txHash'][:12]}… {i['kind']:4} {i['volume'] / 1e6:>12,.2f} USDC -> "
            f"{i['referrer']} ({i['rebate'] / 1e6:.6f} USDC)"
        )

    if not args.post:
        print(f"dry run: nothing broadcast. preview -> {PREVIEW_FILE}")
        return 0

    if not args.ledger:
        print("--post needs --ledger (or REFERRAL_LEDGER)", file=sys.stderr)
        return 2
    key = os.environ.get("REFERRAL_OPERATOR_KEY")
    if not key:
        print("--post needs REFERRAL_OPERATOR_KEY in the environment", file=sys.stderr)
        return 2
    if not items:
        save_state(end)
        return 0

    hashes = post_accruals(items, args.rpc_url, args.ledger, key)
    for h in hashes:
        print(f"  accrue tx {h}")
    save_state(end)
    print(f"accrued {len(hashes)} trades into {args.ledger}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
