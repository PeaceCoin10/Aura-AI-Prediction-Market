# SDK —— 两套前端安全交互层

这个目录里有两个 SDK，**绑定的是两代不同的合约**，别混用：

| 文件 | 绑定合约 | 状态 | 测试 |
|---|---|---|---|
| `CentralPredictionSDK.ts` | **`CentralPredictionEngine`（单合约多盘口）** | ✅ 主网新架构，正在维护 | 66 条（`npm run test:central`） |
| `PredictionSDK.ts` | `PredictionFactory` + `PredictionVault`（一盘口一合约） | 🗄️ 旧架构，合约已归档到 `../legacy/` | 46 条（历史回归） |

新项目请只用 `CentralPredictionSDK`。旧 SDK 保留是因为它的 **MEV 路由 / 私有提交 / 报价新鲜度**
那一层与合约无关，将来接新引擎时可以整层搬过去；它的 calldata 编码器已经不能用于主网合约。

---

# 一、CentralPredictionSDK（新引擎）

```bash
npm install && npm run build
npm test               # 两套都跑：46 + 66 = 112 条
npm run test:central   # 只跑新引擎 66 条
```

```ts
import { CentralPredictionSDK, parseUsdc, OUTCOME_YES } from "./CentralPredictionSDK";

const sdk = new CentralPredictionSDK(
  { ethCall: (to, data) => provider.call({ to, data }), now: async () => BigInt(await latestBlockTs()) },
  { engine: ENGINE, chainId: 8453, account: user },
);

const plan = await sdk.buildBuyShares({
  marketId, outcome: OUTCOME_YES, amountIn: parseUsdc("100"), slippageBps: 100,
});
await sdk.confirmQuoteStillValid(plan);          // 发送前二次确认，价格跑了就中止
await signer.sendTransaction({ to: plan.to, data: plan.data });
```

七个 builder：`buildCreateMarket` / `buildBuyShares` / `buildSellShares` / `buildRedeem` /
`buildResolveMarket` / `buildOverrideResolution`（+ `marketCore` / `resolutionState` / `sharesOf` /
`previewBuy` / `previewSell` / `constants` / `canCreate` / `canOracle` 等只读视图）。

另外内置：**事件解码**（19 个事件，`decodeReceiptLogs`）、**Multicall 批量查询**
（`marketSnapshots`，N 盘口 1 次 RPC）、**滑点档位**（`SLIPPAGE_CONSERVATIVE/NORMAL/DEGEN`）
与 **5% 冲击预警**（`plan.warning === "impact_near_limit"`）。

三条铁律：
1. **没有"直接传 minSharesOut 就放行"的口子**：传 0 拒、高于报价拒、低于报价 95% 拒；
2. **本地同公式复算**：`previewBuyOffline` 必须与链上 `previewBuy` 逐位相等，否则中止（防 ABI 漂移）；
3. **零依赖**：只要一个 `ethCall`，calldata 全部手工编码，测试用 `cast` 逐字节对照。

真链联调（anvil 上把 SDK 造的每一笔交易真的发出去）：

```bash
cd .. && bash script/e2e-sdk-central.sh     # 14 项全 PASS
```

完整对接文档：`../docs/CENTRAL-SDK-GUIDE.md`（ABI 对照表、错误码表、前端状态机、踩坑清单）。

---

# 二、PredictionSDK（旧引擎，历史存档）

目标只有一个：**让前端不可能把 `minSharesOut` 传成 0**。

## 设计约束

1. **没有"直接传 minSharesOut"的接口**。唯一入口是 `buildBuy({ amountIn, slippageBps })`，
   `minSharesOut` 由 `previewBuy()` 现算，调用方拿不到、也改不了。
2. `slippageBps` 必须在 `[1, 500]`。**传 0 直接抛 `SLIPPAGE_NOT_SET`** —— 裸奔在代码层被禁止。
3. 发交易前先做 preflight：最低下注 / 影响上限 / 已结算 / 暂停 / 零份额。
   有问题本地就抛错，不浪费用户 gas。
4. 零依赖。只需传入 `ethCall(to, data)`，可对接 viem / ethers / wagmi。

> ⚠️ 这套 SDK 的 vault/factory 选择器**不能**用于 `CentralPredictionEngine`。
> 旧合约在 `../legacy/contracts/`，可用 `cd ../legacy && forge test` 复跑它们的 89 条回归。

## 用法

```ts
import { PredictionSDK, ethersTransport, SdkError } from "@prediction/sdk";

const sdk = new PredictionSDK(ethersTransport(provider), { vault: VAULT_ADDRESS });

try {
  const plan = await sdk.buildBuy({
    outcome: 1,                  // 1 = YES
    amountIn: 100_000_000n,      // 100 USDC（6 位）
    slippageBps: 100,            // 1%
  });

  console.log("理论上限份额", plan.quote.expectedSharesOut);
  console.log("实际滑点保护", plan.quote.minSharesOut);
  console.log("价格冲击(bps)", plan.quote.priceImpactBps);

  await signer.sendTransaction(plan);   // { to, data, value }
} catch (e) {
  if (e instanceof SdkError) {
    // SLIPPAGE_NOT_SET / SLIPPAGE_TOO_HIGH / BELOW_MIN_BET
    // IMPACT_TOO_HIGH / MARKET_RESOLVED / TRADING_PAUSED / ZERO_SHARES
    showToast(e.code, e.message);
  }
}
```

viem 适配：

```ts
import { PredictionSDK, viemTransport } from "@prediction/sdk";
const sdk = new PredictionSDK(viemTransport(publicClient), { vault });
```

## API

| 方法 | 说明 |
|---|---|
| `getMarketState()` | 读 14 个链上字段（minBet / maxImpactBps / 储备 / 价格 / 费率…） |
| `previewBuy(outcome, amountIn)` | 透传合约 `previewBuy`，返回理论份额 |
| `calculateMinSharesOut(outcome, amountIn, slippageBps)` | **核心**：preview 后按滑点下折 |
| `buildBuy({ outcome, amountIn, slippageBps })` | 返回可直接签名的 `{ to, data, value, quote }` |
| `buildSell({ outcome, sharesIn, slippageBps })` | 同上，卖出侧（复刻合约的储备数学） |

## 为什么卖出要复刻合约数学

旧合约的 `sell` 没有 `previewSell` 视图函数，前端无法直接问"卖这些份额能拿多少"。
SDK 用与合约完全一致的公式本地推导（`newNo = ceil(noReserve*yesReserve/newYes)`），
再扣 1.5% 费率与滑点得到 `minAmountOut`，避免用现价 × 份额这种会被砸穿的下界。

（新引擎已经有 `previewSell` 视图，`CentralPredictionSDK` 直接读链 + 本地复算双保险。）

## 链上验证（做过，不是声称）

`npm run test:e2e` 会起 anvil、部署旧的 vault/factory、然后用 SDK 真实下单：

```
✅ SDK 读取链上状态成功
✅ SDK previewBuy 返回非零报价，minSharesOut 严格低于报价
✅ SDK 生成合法 calldata（selector buy(uint8,uint256,uint256)）
✅ previewBuy 报价 + 1 wei 被合约拒绝（证明报价精确到 1 wei，无有利舍入）
✅ SDK 报价 == 链上实际成交份额 (225956717)
✅ SDK 在本地拦截超上限大单（不浪费 gas）
✅ SDK 拒绝 slippage=0（从代码层杜绝裸奔）
```

旧链路的一键脚本已随合约一起归档到 `../legacy/script/e2e-local.sh`。
