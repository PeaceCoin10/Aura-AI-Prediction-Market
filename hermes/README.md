# Hermes brain (hermes_brain.py)

One process, three engines, running the whole loop -- draft question -> create market -> market it ->
settle it -- with nothing but the `python3` standard library and `cast`.

```
+--------------+   createMarketWithMeta   +-------------------------+
| Creator      | -----------------------> | CentralPredictionEngine |
| (quote->Q)   |   seedLiquidity          |  one contract, N markets|
+------+-------+                          +------------+------------+
       | new market                                    | resolveMarket
       v                                               ^
+--------------+                          +------------+------------+
| Marketing    |  Twitter / Telegram copy | Oracle Engine           |
| (template/LLM)|                          | (settles from real data)|
+--------------+                          +-------------------------+
```

## 1. Environment variables

```bash
export RPC_URL=https://sepolia.base.org        # node
export ENGINE=0x...                            # CentralPredictionEngine
export USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e   # Base Sepolia USDC
export BRAIN_PK=0x...                          # key for create/settle (must be setCreator / setOracle approved)
export SEED_USDC=500                           # market-making seed per new market
export HORIZON_HOURS=24                        # market lifetime
export SITE_URL=https://your-frontend          # link prefix used in marketing copy
```

Optional:
```bash
export TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...   # auto-post to a group
export LLM_API_KEY=...  LLM_MODEL=deepseek-chat      # model-written copy (falls back to templates)
export LLM_BASE_URL=https://api.deepseek.com/v1
```

Optional wick-protection settings:
```bash
export ORACLE_CONFIRM_SAMPLES=3   # consecutive samples before settling (default 3)
export ORACLE_CONFIRM_GAP=30      # seconds between samples (default 30)
```

## 2. Three ways to run it

```bash
# 1) Dry run: no signing, no transactions, just what this cycle would create and settle
python3 hermes/hermes_brain.py --once --dry-run

# 2) Single real cycle (good for cron / a systemd timer)
python3 hermes/hermes_brain.py --once

# 3) Resident loop: one cycle every 300 seconds
python3 hermes/hermes_brain.py --interval 300
```

Other switches:

| Switch | Effect |
|---|---|
| `--creator-only` | Create markets, do not settle |
| `--oracle-only` | Settle, do not create |
| `--no-marketing` | Create markets without generating copy |
| `--require-confirm` | Settlement only writes `proposals/*.json` for a human to approve (default is fully automatic) |
| `--confirm-samples` | Consecutive samples before settling (default 3, env `ORACLE_CONFIRM_SAMPLES`) |
| `--confirm-gap` | Seconds between samples (default 30, env `ORACLE_CONFIRM_GAP`) |
| `--workdir` | Run directory (default `./hermes-runtime`: state / copy / proposals / logs) |

## 3. How it actually decides (do not treat it as a black box)

**Creator**: pulls the real spot price of BTC/ETH/SOL each cycle (CoinGecko -> Binance failover),
sets the threshold to spot x 1.015 rounded to a human-friendly number, and puts both spot and
threshold in the question text. `marketId = keccak256(question)`, so the same question is never
created twice. Immediately after creation it calls `seedLiquidity` to inject market-making capital.

**Verticals**: besides crypto, the brain drafts from three other verticals -- `news` (public RSS:
CoinTelegraph / The Block / Decrypt / BBC / TechCrunch), `sports` (ESPN public scoreboard: NBA, NFL,
Premier League, Champions League, MLS) and `esports` (LoL Esports schedule). A cycle rotates through
them (round-robin from the cycle cursor), reserving one slot per vertical before spending the rest
of the budget, so crypto cannot starve the others. Every draft must pass `validate_binary_question`:
binary (Yes/No only), an explicit resolution time between 30 minutes and 8 days out, and an
objective criteria string of at least 12 characters.

**Marketing**: template engine by default (deterministic, reviewable, no invented numbers); a model
is used only when `LLM_API_KEY` is set, a failed parse falls back to the templates, and the copy file
records `generated_by`.

**Oracle**: only looks at markets that are due and unresolved, then **takes 3 consecutive prices
(30 seconds apart)** and calls `resolveMarket(id, YES/NO)` only when all three land on the same side.
Special paths:
- any failed sample -> skip this cycle (never settle on a guessed price or a partial sample);
- samples disagree (price crossed the threshold inside 60 seconds) -> treat it as a wick/spike, skip
  and resample next cycle;
- a single quote older than 5 minutes -> stale, skip;
- still no quote after "resolution time + 7 days" -> `emergencyRefund(id)`, refunded 0.5/0.5, so user
  principal is never locked.

News / geopolitics markets are `manual` by design: RSS alone cannot prove that "an official
responded", so the brain never auto-settles them -- it only writes a proposal / awaits the Oracle or
Safe decision. Sports and esports are `auto`, and only settle from an official final result (ESPN
final score, LoL Esports gameWins); if the event is postponed or cancelled the admin resolves
`INVALID` with a full refund.

After a settlement the market enters a **1 hour dispute window** (`DISPUTE_WINDOW` in the contract):
withdrawals are still locked, the Safe multisig can `overrideResolution`, and the window finalises on
its own once it passes. The brain writes `dispute_ends_at` into the cycle report and logs
`in dispute window until ...`.

**Real boundaries**: spot prices come from public APIs; production should switch to a signed price
source or a TWAP (Chainlink / Pyth), and it is worth running with `--require-confirm` for a while
before going fully automatic. There is no hand-waving around that.

## 4. State and audit trail

```
hermes-runtime/
+-- hermes_state.json     # question, threshold, direction, resolution time, tx hash per market
+-- outbox/*.md           # marketing copy per new market (twitter / telegram / analysis)
+-- proposals/*.json      # settlement proposals written under --require-confirm
+-- logs/cycles.jsonl     # full JSONL trail of every cycle's decisions (replayable)
```

## 5. Local end-to-end rehearsal (costs nothing)

```bash
# 1) start a chain
anvil --port 8545 --chain-id 31337 &

# 2) deploy the engine (MockUSDC + demo markets are created automatically)
export PATH=/opt/foundry:$PATH
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
TREASURY=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
ADMIN=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
CREATOR=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
ORACLE=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
SEED_DEMO=0 \
forge script script/DeployCentral.s.sol:DeployCentral --rpc-url http://127.0.0.1:8545 --broadcast

# 3) run the brain (copy the engine address from step 2's log)
export RPC_URL=http://127.0.0.1:8545 ENGINE=0x... USDC=0x...(MockUSDC) BRAIN_PK=0xac09...
python3 hermes/hermes_brain.py --once --dry-run
python3 hermes/hermes_brain.py --once

# 4) inspect the chain
cast call $ENGINE "marketCount()(uint256)" --rpc-url $RPC_URL
cast call $ENGINE "marketQuestion(bytes32)(string)" <marketId> --rpc-url $RPC_URL
```

## 6. Production: resident systemd unit

```ini
# /etc/systemd/system/prediction-brain.service
[Unit]
Description=Hermes prediction brain
After=network-online.target

[Service]
Type=simple
User=hermes
WorkingDirectory=/opt/prediction-market
EnvironmentFile=/opt/prediction-market/.env.brain
ExecStart=/usr/bin/python3 hermes/hermes_brain.py --interval 300
Restart=always
RestartSec=15
# the private key lives only in this file, mode 600
# EnvironmentFile carries RPC_URL / ENGINE / USDC / BRAIN_PK / SEED_USDC

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now prediction-brain
journalctl -u prediction-brain -f
```

## 7. Tests

```bash
python3 -m unittest discover -s hermes -p 'test_*.py'    # offline, no chain, no network
```

Coverage: threshold rounding, copy templates (link present, no invented numbers), settlement
decisions (YES/NO/dead feed/stale feed/not due/refund after 7 days), **multi-sample wick
protection (3 agreeing samples / a mid-window flip / a failed sample / exactly 3 samples taken)**,
atomic state writes with corruption tolerance, `marketCore` and `resolutionState` return-value
parsing (including cast's `[1.793e9]` annotation and one-value-per-line output), plus the vertical
drafting path (RSS/Atom parsing, ESPN scoreboard parsing, LoL schedule parsing, binary validation,
rotation and fingerprints) and the vertical -> CreatorEngine / OracleEngine integration.
