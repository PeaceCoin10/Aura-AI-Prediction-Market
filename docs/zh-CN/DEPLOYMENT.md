# 前端公网发布记录

## 当前线上地址（2026-10-27 起有效）

```
https://combination-ladder-scratch-qualifying.trycloudflare.com
```

- 托管方式：本机 `python3 -m http.server 4173` 提供 `frontend/dist`（`vite build` 生产包）
  + **Cloudflare 快速隧道** `cloudflared tunnel --url http://127.0.0.1:4173`（无需账号、无拦截页，
  进程活着地址就稳定）。`cloudflared 2026.10.5` 已装到 `/usr/local/bin/cloudflared`。
- 回落：cloudflared 连续 6 次拿不到地址时自动改用 `ssh -R 80:localhost:4173 nokey@localhost.run`
  （免费档地址会随重连变化）。两条路径都由 `deploy/tunnel.sh` 统一守护并存当前地址到 `PUBLIC-URL.txt`。
- 域名是随机子域名，**隧道断线重连会换名字**（localhost.run 免费档明说「域名会定期更换」，固定域名要账号）；
  已经套了 while-true 自动重连，断线 3 秒内自愈；`deploy/tunnel.sh` 每次拿到新域名都会覆写
  `/root/prediction-market/PUBLIC-URL.txt`，所以永远 `cat PUBLIC-URL.txt` 就能拿到**当前**地址。
- 静态服务与隧道由 `deploy/tunnel.sh` 统一守护（静态服务幂等启动 + ssh while-true 重连 + 域名落盘），
  用 `persist_on_release` 拉起，Hermes 会话结束/清理不会杀；`bash deploy/tunnel.sh --stop` 可整体停掉。
- 已验证：`curl` 首页 200、`/assets/index-*.js` 200、Playwright 真浏览器打开后
  `marketCount` 从 Base 主网读到（`共 0 个盘口` 是链上真实状态）、控制台 0 错误、0 失败请求。

### 自己检查是否还活着

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://combination-ladder-scratch-qualifying.trycloudflare.com/
ps -eo pid,cmd | grep -E "[h]ttp.server 4173|[s]sh -R 80:localhost:4173"
```

## 环境变量（打进了生产包，线上浏览器直接连主网）

`frontend/.env`（`vite build` 时被 inline 到 JS 里）：

```
VITE_ENGINE_ADDRESS=0xE6056Bc6700F6d7E6fF8779B212655284dc1631C
VITE_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
VITE_RPC_URL=https://base-rpc.publicnode.com,https://1rpc.io/base,https://mainnet.base.org
```

已核对：`dist/assets/index-*.js` 里能 `grep 到 0xE6056Bc6700F6d7E6fF8779B212655284dc1631C`。

## 换成永久域名（要一次性凭据，二选一）

隧道地址会变，想要固定域名（`*.vercel.app` / `*.netlify.app`）只差一个 token：

```bash
# Vercel：先在 vercel.com/account/tokens 建 token
npm i -g vercel
cd frontend && npm run build
vercel deploy --prod --yes --token $VERCEL_TOKEN        # 输出 https://<project>.vercel.app

# Netlify：先在 app.netlify.com/user/applications 建 token
npm i -g netlify-cli
cd frontend && npm run build
netlify deploy --prod --dir=dist --auth $NETLIFY_AUTH_TOKEN
```

有 token 之后整条链路是纯命令行的，不需要人工点任何东西；把 token 写进
`/root/.vercel_token`（`chmod 600`）即可复用。

## 静态包本身

`frontend/dist`（≈ 498 KB JS / 21 KB CSS，单页无路由），任何静态服务器都能托管，
`npm run preview` 本地即可验证与线上同一份产物。
