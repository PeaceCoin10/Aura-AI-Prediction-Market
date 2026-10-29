# Local development

Five minutes from clone to a working paper-trading hall; ten more to a real on-chain trade against anvil.

## 1. Prerequisites

| Tool | Version used | Notes |
| --- | --- | --- |
| Foundry | 1.8.5 (`forge`, `anvil`, `cast`) | any recent 1.x works |
| Node | 20+ | the frontend is Vite + React + TS |
| Python | 3.8+ | agent, e2e suites, asset generator |
| Playwright | chromium | `python3 -m playwright install chromium` |

## 2. Frontend only (paper mode, no chain)

```bash
cd frontend
npm install
npm run dev                      # http://127.0.0.1:5173
```

You land in paper mode with 10,000 FAKE-USDC and 12 featured markets; no wallet, no RPC needed. The paper
engine (`src/lib/paper.ts`) reproduces the contract's CPMM maths exactly, which is why the numbers match
the real panel to the wei.

`insights.json` is optional: if `frontend/public/insights.json` has no items, the AI desk falls back to the
local rule engine (`src/lib/insights.ts`).

## 3. Contracts and a real chain

```bash
# terminal 1
anvil --chain-id 8453 --port 8545

# terminal 2 — deploys MockUSDC + vault + engine and seeds one demo market
export PATH=/opt/foundry:$PATH
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
SEED_DEMO=1 REQUIRE_SAFE_CONTRACT=0 \
forge script script/DeployCentral.s.sol:DeployCentral \
  --rpc-url http://127.0.0.1:8545 --broadcast
```

The script prints the addresses; export them for the frontend build:

```bash
cd frontend
VITE_ENGINE_ADDRESS=<engine> VITE_USDC_ADDRESS=<mockUsdc> VITE_RPC_URL=http://127.0.0.1:8545 \
  npm run build
cd dist && python3 -m http.server 4181 --bind 127.0.0.1
```

Fund anvil account #1 so the browser wallet can trade:

```bash
cast send <mockUsdc> "mint(address,uint256)" 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 500000000 \
  --rpc-url http://127.0.0.1:8545 --private-key <anvil#0 key>
cast send <mockUsdc> "approve(address,uint256)" <engine> 1000000000000 \
  --rpc-url http://127.0.0.1:8545 --private-key <anvil#0 key>
```

On chain **8453** the deploy script takes the production safety path (`REQUIRE_SAFE_CONTRACT=1`, admin and
treasury must be contracts). Use `REQUIRE_SAFE_CONTRACT=0` only on a local fork.

## 4. The five suites

```bash
forge test                                                    # 46 · contracts
cd sdk && npm test                                            # 70 · SDK, fully offline
python3 -m unittest discover -s hermes -p 'test_*.py'          # 49 · agent

cd frontend
npx tsc --noEmit                                              # types
npm run build                                                 # production bundle
python3 scripts/e2e_ui.py http://127.0.0.1:4173/              # 63 · UI, headless
python3 scripts/e2e_local.py http://127.0.0.1:4181/ http://127.0.0.1:8545   # 12 · real chain
```

`e2e_ui.py` asserts a first-run path (risk modal → 10k bonus → hall), the 12 featured markets, the 7-second
tick, a paper fill, posting a take, both overlays, the Real/Paper switch, brand assets and a 390×844 mobile
layout with no horizontal overflow. `e2e_local.py` injects an EIP-1193 wallet, buys on-chain and checks the
position and the decoded event feed.

## 5. Regenerating assets and screenshots

```bash
python3 frontend/scripts/gen_brand_assets.py      # banner, logo, favicon, apple-touch-icon, og.png
python3 frontend/scripts/shots.py http://127.0.0.1:4173/ reports/shots
```

Both use Playwright, so the same chromium install covers tests and assets.

## 6. Adding a locale

```
frontend/src/locales/en/        one namespace file per surface
frontend/src/lib/i18n.tsx       typed tree, registerLocale, {{var}} interpolation
```

Create `frontend/src/locales/<code>/index.ts` satisfying the `Messages` type and call `registerLocale()`
once. The header chip becomes a `<select>` automatically; no component changes.

## 7. Conventions that are enforced, not suggested

- Money is `bigint` in base units end to end; format only at the edge.
- Contract outcome encoding is `0 = NO, 1 = YES`; the UI's side index is the reverse. The single mapping
  lives in `src/lib/paper.ts` and is covered by tests — never re-derive it inline.
- Anything simulated must be labelled simulated in the copy (`Sample`, `Simulated ticks`, `Paper mode`).
- No Chinese characters in shipped UI code; the check is part of the acceptance run:
  `grep -rlP '[\x{4e00}-\x{9fff}]' frontend/src` must be empty.
