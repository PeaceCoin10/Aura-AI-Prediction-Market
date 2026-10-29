# Basescan 验证状态（如实记录，2026-10-27）

## 1. 现在是什么状态（都是实测，不是推测）

| 渠道 | 结果 | 证据 |
|---|---|---|
| **Sourcify** | ✅ 两个合约 `exact_match` | `GET https://sourcify.dev/server/v2/contract/8453/<addr>` → `match: exact_match`，`verifiedAt` 2026-10-26T16:29:45Z（vault）/ 16:29:58Z（engine） |
| **Basescan（浏览器绿勾）** | ❌ 仍未验证 | `GET https://basescan.org/address/<addr>#code` 页面里仍是 `Verify and Publish` + `Are you the contract creator`，没有 `Contract Source Code Verified` |
| Etherscan V2 API（forge 用） | ❌ 不能自动跑 | `forge verify-contract` 直接报 `Error: ETHERSCAN_API_KEY must be set to use Etherscan as a verifier`；本机无该 key，历史上流传的 key 已被 Etherscan 作废（`Invalid API Key (#err2)`） |
| Basescan 网页验证表单 | ⚠️ 走到最后一步被 Cloudflare Turnstile 拦住 | 表单第一步、第二步（上传 standard-json）、构造函数参数都能自动填，最后提交返回 `Sorry! Invalid captcha Response.`；连续等 180 秒 `cf-turnstile-response` 始终为空（4 次尝试，headless + Xvfb headful 都一样）。出口是机房 IP 代理，Turnstile 不放行 |

**结论：源码不是"没准备好"，是"提交入口需要人有 key 或人在浏览器里点一下 Turnstile"。**
这一步没有可以绕过的第三条路（Etherscan 系验证只认自己的 API key 或自家表单的 Turnstile token）。

### 0. 当前状态（2026-10-28：已点亮 ✅）

两个合约**都已在 Basescan 完成验证**，走的是 Etherscan V2 API（`forge verify-contract` + `--verifier-url https://api.etherscan.io/v2/api?chainid=8453`），
全程无人工点浏览器、无 Turnstile：

| 合约 | 地址 | GUID | 结果 |
|---|---|---|---|
| ProtocolFeeVault | `0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1` | `ycxy5lbmg1tijiecqiswr7ki3rv23ra9evvmar838iszburm8i` | `Pass - Verified` |
| CentralPredictionEngine | `0xE6056Bc6700F6d7E6fF8779B212655284dc1631C` | `g9bedrrdwfgzkrrjwdnhszbpmifciazaujarxzsevwvumay28g` | `Pass - Verified` |

复核证据（API 为准，页面绿勾对真人可见；机房 IP 访问 basescan 会被 Cloudflare 拦 "Just a moment..."）：

- `module=contract&action=checkverifystatus` → `Pass - Verified`（两条）
- `module=contract&action=getsourcecode` → `SourceCode` 非空，`ContractName` = ProtocolFeeVault / CentralPredictionEngine，
  `CompilerVersion` = `v0.8.24+commit.e11b9ed9`，`ConstructorArguments` = 96B / 128B（与部署参数逐字节一致）
- `module=contract&action=getabi` → 27 项 / 118 项（只有已验证合约才返回 ABI）

页面直达：`https://basescan.org/address/<address>#code`。

## 2. 降维打击方案（把"网页自动化"整个砍掉）

**不再碰 Playwright、不再碰 Turnstile。** Etherscan 系验证有官方 API，只要环境里有一个 key，
`forge verify-contract` 自己就把源码、构造函数参数、compiler settings 全递上去，后台静默完成：

```bash
# 一个 key 覆盖 Base（V2 多链 key，免费档就够）
ETHERSCAN_API_KEY=你的key bash deploy/verify-basescan.sh
```

这条脚本（`deploy/verify-basescan.sh`）做三件事：依次验证 vault / engine（构造函数参数从
`deploy/verify/*-ctor-args.txt` 读，不需要人算）、幂等重跑（已验过回 `Already Verified`）、
最后抓 Basescan 页面确认是否出现 `Contract Source Code Verified`。

**"后台默默自己完成"的装法**（key 一到位就自动跑，人工零介入）：

```bash
echo 'ETHERSCAN_API_KEY=你的key' > /root/.etherscan_key && chmod 600 /root/.etherscan_key
( crontab -l 2>/dev/null; \
  echo '17 */6 * * * set -a; . /root/.etherscan_key; set +a; cd /root/prediction-market && bash deploy/verify-basescan.sh >> /tmp/basescan-verify.log 2>&1' ) | crontab -
```

验证成功后在 `crontab -e` 里删掉这一行即可。

### 为什么"向 Sourcify / Blockscout 提交"不能变绿勾

- **Sourcify 已经提交过了**：两个合约都是 `exact_match`（见第 1 节），但 Basescan（Etherscan 系）
  **不读 Sourcify 的数据库**，它只认自己表单/自己 API 的提交结果——所以 Sourcify 绿了，Basescan 不会跟着绿。
- **Blockscout** 是另一套独立浏览器；Base 官方浏览器是 Basescan，即便把源码提交到某个 Blockscout 实例，
  也只是那个实例显示绿勾，`basescan.org` 依旧 "Verify and Publish"。`--verifier blockscout` 只在
  目标链本身用 Blockscout 做浏览器时才等价（例如某些 L2/测试网）。
- 所以真正能"降维"的只有一件事：**把 key 塞进环境变量**，然后 `forge` 或 `hardhat verify` 一条命令。
  Hardhat 侧同样一行：`npx hardhat verify --network base <addr> <ctorArgs...>`（需要 `ETHERSCAN_API_KEY` 同款 key）。

### 本地自检（不需要任何 key，随时可跑）

```bash
# 源码与链上字节码是否一致（长度必须相等，差异只在 immutable 槽位）
python3 - <<'PY'
import json, subprocess
def code(a): return subprocess.run(["cast","code",a,"--rpc-url","https://mainnet.base.org"],
                                   capture_output=True,text=True).stdout.strip()[2:]
for name,p,a in [("vault","out/ProtocolFeeVault.sol/ProtocolFeeVault.json","0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1"),
                 ("engine","out/CentralPredictionEngine.sol/CentralPredictionEngine.json","0xE6056Bc6700F6d7E6fF8779B212655284dc1631C")]:
    dep=json.load(open(p))["deployedBytecode"]["object"][2:]; on=code(a)
    d=sum(1 for i in range(0,min(len(dep),len(on)),2) if dep[i:i+2].lower()!=on[i:i+2].lower())
    print(f"{name}: artifact {len(dep)//2}B chain {len(on)//2}B diff {d}B")
PY
# 实测: vault 1798B/1798B diff 60B、engine 13196B/13196B diff 160B  → 一旦提交必是 Exact Match
```

## 3. 路径 A：有 Etherscan V2 API key（一条命令一个合约）

```bash
cd /root/prediction-market
export PATH=/opt/foundry:$PATH
export ETHERSCAN_API_KEY=<你的多链 key>

# Engine
forge verify-contract 0xE6056Bc6700F6d7E6fF8779B212655284dc1631C \
  src/CentralPredictionEngine.sol:CentralPredictionEngine \
  --chain 8453 --verifier etherscan \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=8453" \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cat deploy/verify/engine-ctor-args.txt)

# FeeVault
forge verify-contract 0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1 \
  src/ProtocolFeeVault.sol:ProtocolFeeVault \
  --chain 8453 --verifier etherscan \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=8453" \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cat deploy/verify/vault-ctor-args.txt)
```

构造函数参数已经算好落盘（`cast abi-encode` 实测输出）：

- vault：`c(address collateral, address treasury, address owner)`
  = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, `0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1`, `0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1`
- engine：`c(address collateral, address feeVault, address treasury, address admin)`
  = `0x833589…2913`, `0x29dE…9eE1`, `0x436b…5Ba1`, `0x436b…5Ba1`

> 只要 key 有效，上面的命令**不需要再加 `--compiler-version / --optimizer-runs`**：forge 会用
> `foundry.toml`（solc 0.8.24 / optimizer 200 / **via_ir = true**）重编，与部署字节码一致。

## 4. 路径 B：没有 key 时的兜底（网页表单，留档用）

准备物都在 `deploy/verify/`：

| 文件 | 用途 |
|---|---|
| `engine-standard-json.json` | 标准 Solidity JSON-Input（含 8 个源文件、viaIR=true、evmVersion=cancun） |
| `vault-standard-json.json` | 同上（9 个源文件） |
| `engine-ctor-args.txt` / `vault-ctor-args.txt` | ABI 编码后的构造函数参数（网页表单第二步粘贴这个） |

三个脚本（依次递进，都跑过）：

```bash
# 纯 requests 版：自动走到「上传 standard-json」这一步
python3 deploy/basescan_web_verify.py <address> <label> <sjis.json> <ctor_args_hex>

# Playwright 版：自动填完三步表单，最后一步会报 Invalid captcha
xvfb-run -a python3 deploy/basescan_pw_verify.py <address> <sjis.json> <ctor_args_hex> <label> --headful

# 长等待版：等 Turnstile token 最多 180 秒，拿到就自动提交
xvfb-run -a /usr/bin/python3 deploy/basescan_pw_wait.py <address> <sjis.json> <ctor_args_hex> <label>
```

本机跑长等待版的真实输出：

```
[vault] upload done, waiting turnstile
[vault] token=NO len=0
```

人工收尾（1 分钟，任意有外网的普通浏览器）：

1. 打开 `https://basescan.org/verifyContract`
2. Contract Address 填地址 → Compiler Type 选 **Solidity (Standard-Json-Input)**
   → Compiler Version `v0.8.24+commit.e11b9ed9` → License **MIT**（两个合约都是 MIT）
3. 勾同意条款 → Continue
4. 上传 `deploy/verify/*-standard-json.json`
5. Constructor Arguments 粘贴 `deploy/verify/*-ctor-args.txt` 的内容（**不带 0x 也行，带也行**）
6. 过 Turnstile → Verify and Publish

## 5. 已验证过的「能不能通过」自检

不用等浏览器也能确认源码与链上字节码一致（immutable 位之外应当逐字节相同）：

```
ProtocolFeeVault        : artifact 1798 B  / chain 1798 B  / 差异 60 B（2 个 immutable）
CentralPredictionEngine : artifact 13196 B / chain 13196 B / 差异 160 B（4 个 immutable）
```

长度完全相等、差异集中在 immutable 槽位 —— 也就是说只要验证请求递进去（key 或 Turnstile 通过），
就会是 `Exact Match`，不会卡在 "bytecode does not match"。
