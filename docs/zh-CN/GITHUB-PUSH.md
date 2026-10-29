# 把 Aura 推到你的 GitHub（免登录 · PAT 一键脚本）

> 目标：**在服务器/WSL 上不需要浏览器登录态，也能把整个仓库推到你自己的 GitHub 账号。**
> 一条命令，脚本自动建仓库、提交、推 main、回读 SHA 校验。

---

## 0. 30 秒版本

```bash
# 1) 去 https://github.com/settings/tokens 建一个 PAT（勾 repo 权限，见 §1）
# 2) 一条命令搞定
cd /root/prediction-market
GITHUB_TOKEN=ghp_你的token ./scripts/github_push.sh
```

成功后会打印：

```
✓ 登录身份：<你的登录名>
✓ 仓库已创建
✓ 已提交：<sha> chore: snapshot …
✓ 推送完成
✓ 远端 HEAD 已对上：<sha>
  仓库地址   https://github.com/<你>/Aura-AI-Prediction-Market
```

仓库名默认 `Aura-AI-Prediction-Market`，可用 `REPO_NAME=` 覆盖；私有仓库加 `--private`。

---

## 1. 建 PAT（关键一步，30 秒）

| 类型 | 勾什么 | 链接 |
| --- | --- | --- |
| **Classic（最省事，推荐）** | `repo`（全勾：仓库读写 + 建仓库） | https://github.com/settings/tokens/new |
| Fine-grained | Repository permissions → **Contents: Read and write**；Account permissions → **Administration: Read and write**（建仓库需要） | https://github.com/settings/personal-access-tokens/new |

注意：
- **Fine-grained 令牌必须选「All repositories」**，否则新仓库不在授权范围内，会 push 403。
- 复制一次就看不到了，直接粘给脚本（脚本不会回显、不会写进 shell 历史之外的地方）。

---

## 2. 三种用法

```bash
# A. 环境变量（CI / 一次跑完，非交互）
GITHUB_TOKEN=ghp_xxx ./scripts/github_push.sh

# B. 交互（终端里粘贴，输入不回显）
./scripts/github_push.sh

# C. 先看它要干什么（不碰网络、不写提交）
./scripts/github_push.sh --dry-run
```

其他开关：

```bash
REPO_NAME=My-Prediction-Market ./scripts/github_push.sh   # 换仓库名
./scripts/github_push.sh --private                        # 私有仓库
COMMIT_MSG="feat: paper-first hall" ./scripts/github_push.sh
BRANCH=main ./scripts/github_push.sh                      # 默认就是 main
```

---

## 3. 脚本到底做了什么

| 步骤 | 命令 / API | 失败会怎样 |
| --- | --- | --- |
| 1. 校验 PAT | `GET https://api.github.com/user` | 直接报「PAT 无效」，不碰仓库 |
| 2. 查仓库 | `GET /repos/<你>/<仓库>` | 404 就 `POST /user/repos` 建一个 |
| 3. 提交 | `git add -A && git commit` | 工作区干净则跳过 |
| 4. 推送 | `git push -u origin main`，token 经**临时 GIT_ASKPASS** 注入 | 非快进会失败并提示，**绝不 force push** |
| 5. 回读校验 | `GET /repos/…/commits/main` 比对本地 SHA | 不一致直接报错，不会假装成功 |

### 安全设计（为什么这个脚本可以放心跑）

- Token **不进 argv**（`ps` 里看不到）、**不进 `.git/config`**（remote 只存干净 URL）、**不进 git 历史**。
- 临时 askpass 脚本放在 `mktemp -d` 里，`chmod 700`，`trap` 在退出时删除。
- `.gitignore` 已排除 `node_modules/`、`out/`、`cache/`、`broadcast/`、`*.log`、`.env*`、`hermes-runtime/`、`frontend/dist/`，不会把私钥与 800MB 依赖推上去。
- 推完 remote 是干净地址，之后要再推需要重新给 token（或者你主动 `gh auth login`）。

---

## 4. 常见报错对照表

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `PAT 无效或网络不通（curl 失败）` | token 打错 / 过期 / 代理挡住 api.github.com | 换个 token；确认 `HTTPS_PROXY` 能通 `api.github.com` |
| `创建仓库失败（PAT 是否带 repo 权限？）` | Classic 没勾 `repo`；Fine-grained 没开 Administration | 按 §1 重新勾 |
| `remote: Permission to … denied` | token 对目标仓库无写权限（Fine-grained 只授权了部分仓库） | 改成 All repositories 或把该仓库加入授权 |
| `Updates were rejected because the remote contains work…` | 远端已有人推过（比如你手动建了带 README 的仓库） | `git pull --rebase origin main` 后再跑脚本 |
| `host key verification failed` | 走 SSH 了 | 本脚本只用 HTTPS，检查 `GIT_REMOTE_URL` 是否被改过 |
| 推上去发现缺文件 | 被 `.gitignore` 排除了 | `git check-ignore -v <文件>` 看是哪条规则 |

---

## 5. 推完之后

```bash
git remote -v          # origin 是干净 URL（无 token）
git log --oneline -3   # 本地提交
curl -s https://api.github.com/repos/<你>/Aura-AI-Prediction-Market \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["html_url"], d["size"], "KB")'
```

想让它变成**永久域名网站**：仓库推到 GitHub 后，用 `deploy/vercel.sh` 或 `deploy/netlify.sh`（见
[`DEPLOY-PERMANENT.md`](./DEPLOY-PERMANENT.md)），两者都能直接连你这个仓库自动构建。

---

## 6. 脚本自测（不需要真 token）

```bash
python3 deploy/test_github_push_mock.py
```

它起一个本地 mock GitHub API + 本地 bare 仓库，真跑「校验 → 建/查仓库 → 提交 → 推送 → 回读 SHA」，
实测输出：

```
✓ 登录身份：yolanda
✓ 推送完成
✓ 远端 HEAD 已对上：9878f946
RESULT: ALL PASS
```

同一套逻辑在真 GitHub 上只是把 mock 换成 `api.github.com`，其余完全一致。
