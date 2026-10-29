# 永久域名部署（Vercel / Netlify，一条命令）

> `trycloudflare.com` 是**临时隧道**：进程一停、机器一睡、重启一次，地址就换。
> 这份文档给两条「一次部署、永久在线、HTTPS、可绑自有域名」的路径，都是一条命令。

| | Vercel | Netlify |
| --- | --- | --- |
| 命令 | `VERCEL_TOKEN=xxx ./deploy/vercel.sh` | `NETLIFY_TOKEN=xxx ./deploy/netlify.sh` |
| 是否需要装 CLI | 需要（脚本用 `npx vercel` 自动拉，无需手动装） | **不需要**，纯 REST API + zip 直传 |
| 构建在哪跑 | Vercel 云端（`vercel.json` 指定） | 本地 build 后上传（或连 GitHub 走 `netlify.toml`） |
| 首次耗时 | 30–90 秒 | 10–30 秒 |
| 域名 | `https://<project>.vercel.app` | `https://<site>.netlify.app` |
| 免费额度 | Hobby 够用 | 100GB 流量/月 |
| 适合 | 想连 GitHub 自动 CI 部署 | 想「不装任何东西、纯 token 直传」 |

---

## A. Vercel（推荐，能连 GitHub 自动部署）

### 1) 拿 token
https://vercel.com/account/tokens → Create Token（Scope 选你的个人账号，或用 `VERCEL_TEAM_ID` 指定团队）。

### 2) 一条命令

```bash
cd /root/prediction-market
VERCEL_TOKEN=你的token ./deploy/vercel.sh
# 想换项目名：PROJECT=aura-prediction-market VERCEL_TOKEN=... ./deploy/vercel.sh
# 先看步骤不执行：./deploy/vercel.sh --dry-run
```

脚本做四件事：
1. `GET /v9/projects/<project>` → 404 就 `POST /v11/projects` 建项目（幂等，跑多少次都行）
2. `npx vercel link --yes --project <project>` → 绑定本地目录（`.vercel/` 已 gitignore）
3. `npx vercel deploy --prod --yes` → 云端 `cd frontend && npm install && npm run build`
4. `curl -I https://<project>.vercel.app` → **必须 200 才算成功**，否则报错退出

### 3) 产物
- 永久地址：`https://<project>.vercel.app`，写进 `deploy/.vercel-url`
- 面板：https://vercel.com/dashboard
- 想绑自有域名：面板 → Project → Settings → Domains → 加 `aura.你的域名`，按提示加 CNAME

### 4) 之后每次更新
```bash
git push            # 若已把 GitHub 仓库连到 Vercel，自动重建
# 或者手动：
VERCEL_TOKEN=xxx ./deploy/vercel.sh
```

---

## B. Netlify（纯 token，不装 CLI）

### 1) 拿 token
https://app.netlify.com/user/applications#personal-access-tokens → New access token。

### 2) 一条命令

```bash
cd /root/prediction-market
NETLIFY_TOKEN=你的token ./deploy/netlify.sh --build
# 换站名：SITE_NAME=aura-prediction-market NETLIFY_TOKEN=... ./deploy/netlify.sh --build
```

内部流程（全部 REST，无第三方依赖）：
1. `npm --prefix frontend run build`（`--build` 或 dist 不存在时）
2. `POST /api/v1/sites {name}` → 名字被占则自动退到随机子域，不会失败
3. `frontend/dist` 打成 zip → `POST /api/v1/sites/<id>/deploys`（`Content-Type: application/zip`）
4. 轮询 `GET /api/v1/deploys/<id>` 直到 `state=ready`（最多 90 秒）
5. 回读站点 URL，HTTP 200 才算成功，写到 `deploy/.netlify-url`

### 3) 已做的离线验证
```bash
python3 deploy/test_netlify_mock.py
# ✓ 站点 ID：site-mock-1
# ✓ 包大小 200K
# ✓ 线上已可用（HTTP 200）
# site_created=1 zip_entries=6 polls=2 index=True
# RESULT: ALL PASS
```
mock 服务器实现了与 Netlify 相同的三接口；脚本逻辑（zip 内容、轮询、回读）已实测，换成真 token 即真部署。

---

## C. 两条路径共用的构建配置（已在仓库里）

`vercel.json`
```json
{
  "installCommand": "cd frontend && npm install",
  "buildCommand": "cd frontend && npm run build",
  "outputDirectory": "frontend/dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

`netlify.toml`
```toml
[build]
  base = "frontend"
  command = "npm ci && npm run build"
  publish = "dist"
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

要点：
- **`@sdk` 别名** 指向 `../sdk/CentralPredictionSDK.ts`，云端 clone 的是整个仓库，所以能解析；
  Vercel/Netlify 的构建根目录虽然设成 `frontend`，父目录文件仍在（不要用「只上传子目录」的部署方式）。
- `public/insights.json` 会原样进 `dist`，AI 智囊团在静态站上依然有数据可读；缓存头已设 `max-age=0`。
- 单页应用必须有 SPA rewrite，否则刷新 `/portfolio` 之类的路径会 404。

---

## D. 静态站的能力边界（别夸大）

| 能力 | 部署到 Vercel/Netlify 后 |
| --- | --- |
| 大厅 / 12 个示例盘口 / 模拟下单 / 辩论墙 / 分享海报 | ✅ 全在浏览器里，静态托管即可 |
| 链上实盘交易 | ✅ 用户自己的钱包签名，前端只读公共 RPC |
| Hermes AI 大脑「自动出题 + 结算」 | ❌ 那是服务器侧 Python 长驻进程（`hermes/hermes_brain.py`），不在静态站里；部署在自己机器上跑 |
| 大脑实时评述 | ⚠️ 静态站读的是构建时那份 `insights.json` 快照；要实时就让大脑把文件同步进仓库再重建（或接一个 KV/API） |

---

## E. 故障排查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| Vercel 构建失败 `Cannot find module '@sdk'` | 只传了 `frontend` 目录 | 必须整仓部署（脚本就是这么做的） |
| 打开是 404 / 白屏 | 少了 SPA rewrite | 确认 `vercel.json` / `netlify.toml` 在仓库根 |
| 站点 200 但页面空 | `outputDirectory` 配错 | 实际产物在 `frontend/dist`，不是 `dist` |
| Netlify 上传 422 | zip 里塞了 `node_modules` | 脚本只 zips `frontend/dist` |
| Vercel `400 invalid token` | token 属于别的 scope | 设 `VERCEL_TEAM_ID` 或换账号 token |
| 域名能开但 RPC 报错 | 公共 RPC 被墙 | 前端可换 `VITE_RPC_URL`（逗号分隔多源 fallback）后再部署 |
