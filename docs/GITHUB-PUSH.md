# Publish this repository with a PAT

The server has no GitHub browser session, and it never needs one. A **fine-grained or classic personal
access token** is enough to create the repo, push the tree and read the result back.

## 1. Make a token

| Kind | Where | What to grant |
| --- | --- | --- |
| Classic (simplest) | Settings → Developer settings → Tokens (classic) → Generate new token | scope `repo` (plus `workflow` if you want to push `.github/workflows/`) |
| Fine-grained | Settings → Developer settings → Fine-grained tokens | Repository access: *All repositories*; Permissions: **Contents: read & write**, **Administration: read & write** (create repo), **Pages: read & write** (Pages deploy), **Metadata: read** |

Copy the token once — GitHub will not show it again.

## 2. Push

```bash
# option A · environment variable (recommended)
GITHUB_TOKEN=ghp_xxxxxxxx ./scripts/github_push.sh

# option B · token file, chmod 600, never committed
printf '%s' 'ghp_xxxxxxxx' > ~/.github_token && chmod 600 ~/.github_token
./scripts/github_push.sh

# option C · interactive, input is hidden and never echoed
./scripts/github_push.sh            # prompts: "GitHub token:"
```

Optional environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `OWNER` | derived from `origin`, else token owner | target account/org |
| `REPO_NAME` | `Aura-AI-Prediction-Market` | repository name |
| `PRIVATE` | `0` | `1` → create a private repo |
| `BRANCH` | `main` | branch to push |
| `COMMIT_MSG` | generated | commit message |
| `DRY_RUN` | `0` | `1` → print the plan, touch nothing |

## What the script actually does

1. Validates the token against `GET /user` and prints the login (fails fast on a bad scope).
2. `GET /repos/<owner>/<repo>` — creates it (`POST /user/repos`) if it does not exist, then applies the
   description and topics.
3. `git init -b main` if needed, stages everything the `.gitignore` allows, commits.
4. Adds/updates `origin` **without** the token in the URL, then pushes through a temporary
   `GIT_ASKPASS` helper that is deleted in the same shell.
5. Reads the remote HEAD SHA back over the API and prints it, so "pushed" is a verified fact, not a claim.

The token therefore never appears in `.git/config`, in the remote URL, in `ps`, or in shell history.

## Starting from a single clean commit

If the remote carries history you do not want in public view, the repo can be rewritten from scratch:

```bash
# local: one root commit holding the current tree
git checkout --orphan clean-main
git add -A
git commit -m "feat: Aura — agentic prediction markets on Base"
git branch -M clean-main main

# remote: overwrite every branch with this single commit
GITHUB_TOKEN=ghp_xxx ./scripts/github_push.sh --force
```

`--force` is opt-in and only ever targets `OWNER/REPO_NAME`. Anything else keeps the default
non-destructive fast-forward behaviour.

## Repository settings applied by the script

```
description : AI-written prediction markets on Base — CPMM pricing, on-chain settlement, paper trading
topics      : web3, prediction-market, base, ai-agent, defi, cpmm
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `401 Bad credentials` | token expired or mistyped | regenerate; paste without quotes/whitespace |
| `403 Resource not accessible by personal access token` | missing scope | classic: `repo`; fine-grained: Contents + Administration write |
| `403 … workflow … scope` | pushing `.github/workflows/` with a classic token lacking `workflow` | add the `workflow` scope |
| `remote: Permission to <owner>/<repo> denied` | token belongs to another account | `OWNER=<your-login>` |
| `src refspec main does not match any` | no commits yet | the script commits first; check `git status` |
| `failed to push some refs (fetch first)` | remote has commits you do not have | `--force` (rewrites history) or `git pull --rebase` |
| `Repository not found` after creating it | Pages/API cache | retry once; the script re-reads over REST |

## Verifying without logging in

```bash
curl -s https://api.github.com/repos/<owner>/<repo> \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["html_url"], d["default_branch"], d["pushed_at"])'
```

If that prints a URL and a timestamp inside the last few minutes, the push is real.
