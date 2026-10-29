#!/usr/bin/env python3
"""Offline self-test for scripts/github_push.sh: a mock GitHub API plus a local bare repo.

Proves the script really does: validate the PAT → look up/create the repo → commit → add remote → real push → read back and verify the SHA.
Fully offline; no real token needed.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8901
MOCK_USER = "yolanda"
REMOTE = "/tmp/aura_mock_remote.git"
CALLS = {"user": 0, "repo": 0, "commits": 0, "create": 0}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/user":
            CALLS["user"] += 1
            self._json({"login": MOCK_USER})
        elif self.path.endswith("/commits/main"):
            CALLS["commits"] += 1
            sha = subprocess.run(
                ["git", "--git-dir", REMOTE, "rev-parse", "main"], capture_output=True, text=True
            ).stdout.strip()
            self._json({"sha": sha, "commit": {"message": "mock"}})
        else:
            CALLS["repo"] += 1
            self._json({"id": 1, "full_name": f"{MOCK_USER}/Aura-AI-Prediction-Market"})

    def do_POST(self):
        CALLS["create"] += 1
        n = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(n)
        self._json({"id": 1, "name": "Aura-AI-Prediction-Market"}, 201)


def main() -> int:
    for p in (REMOTE, "/tmp/aura_gh_work"):
        shutil.rmtree(p, ignore_errors=True)
    subprocess.run(["git", "init", "--bare", "-q", REMOTE], check=True)
    subprocess.run(["git", "--git-dir", REMOTE, "symbolic-ref", "HEAD", "refs/heads/main"], check=True)

    work = "/tmp/aura_gh_work"
    os.makedirs(os.path.join(work, "scripts"))
    shutil.copy(os.path.join(ROOT, "scripts", "github_push.sh"), os.path.join(work, "scripts"))
    with open(os.path.join(work, "README.md"), "w") as f:
        f.write("# Aura test workspace\n")
    with open(os.path.join(work, "app.py"), "w") as f:
        f.write("print('aura')\n")

    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    env = dict(
        os.environ,
        GITHUB_TOKEN="mock_pat_123",
        GITHUB_API=f"http://127.0.0.1:{PORT}",
        GIT_REMOTE_URL=REMOTE,
    )
    for k in ("http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        env.pop(k, None)

    r = subprocess.run(["bash", os.path.join(work, "scripts", "github_push.sh")], cwd=work, env=env, capture_output=True, text=True)
    print(r.stdout)
    if r.returncode != 0:
        print("STDERR:", r.stderr[-1500:])
        srv.shutdown()
        return 1

    remote_head = subprocess.run(["git", "--git-dir", REMOTE, "rev-parse", "main"], capture_output=True, text=True).stdout.strip()
    local_head = subprocess.run(["git", "rev-parse", "main"], cwd=work, capture_output=True, text=True).stdout.strip()
    tracked = subprocess.run(["git", "--git-dir", REMOTE, "ls-tree", "-r", "--name-only", "main"], capture_output=True, text=True).stdout.split()

    ok = (
        remote_head
        and remote_head == local_head
        and "app.py" in tracked
        and "README.md" in tracked
        and CALLS["user"] >= 1
        and CALLS["commits"] >= 1
        and "remote HEAD verified" in r.stdout
    )
    print(f"local={local_head[:8]} remote={remote_head[:8]} tracked={len(tracked)} calls={CALLS}")
    print("RESULT:", "ALL PASS" if ok else "FAIL")
    srv.shutdown()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
