#!/usr/bin/env python3
"""Offline self-test for deploy/netlify.sh: a local mock Netlify API drives the whole zip deploy path.

Proves the script really does: create site → zip → upload → poll state → read back HTTP 200.
Needs no token and never touches the network.
"""
import json
import os
import subprocess
import sys
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8899
SITE_URL = "http://127.0.0.1:4173"  # static preview server the caller must start first
state = {"polls": 0, "zip_bytes": 0, "zip_entries": 0, "site_created": 0}


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

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        if self.path.endswith("/sites"):
            state["site_created"] += 1
            self.rfile.read(n)
            self._json({"id": "site-mock-1", "ssl_url": SITE_URL, "name": "aura-prediction-market"})
        elif "/deploys" in self.path:
            data = self.rfile.read(n)
            state["zip_bytes"] = len(data)
            open("/tmp/aura_mock_upload.zip", "wb").write(data)
            with zipfile.ZipFile("/tmp/aura_mock_upload.zip") as z:
                state["zip_entries"] = len(z.namelist())
            self._json({"id": "dep-mock-1", "state": "uploaded"})
        else:
            self._json({"error": "not found"}, 404)

    def do_GET(self):
        if self.path.startswith("/deploys/"):
            state["polls"] += 1
            self._json({"id": "dep-mock-1", "state": "ready" if state["polls"] >= 2 else "processing"})
        else:
            self._json({"error": "not found"}, 404)


def main() -> int:
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    env = dict(os.environ, NETLIFY_API=f"http://127.0.0.1:{PORT}", NETLIFY_TOKEN="mock-token")
    env.pop("http_proxy", None)
    env.pop("https_proxy", None)
    env.pop("all_proxy", None)
    r = subprocess.run(["bash", os.path.join(ROOT, "deploy", "netlify.sh")], env=env, capture_output=True, text=True)
    print(r.stdout[-1600:])
    if r.returncode != 0:
        print("STDERR:", r.stderr[-1200:])
        srv.shutdown()
        return 1

    with zipfile.ZipFile("/tmp/aura_mock_upload.zip") as z:
        names = z.namelist()
    ok = (
        state["site_created"] >= 1
        and state["zip_entries"] > 3
        and "index.html" in names
        and any(n.startswith("assets/") for n in names)
        and state["polls"] >= 2
        and os.path.exists(os.path.join(ROOT, "deploy", ".netlify-url"))
    )
    print(f"site_created={state['site_created']} zip_entries={state['zip_entries']} polls={state['polls']} index={'index.html' in names}")
    print("RESULT:", "ALL PASS" if ok else "FAIL")
    srv.shutdown()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
