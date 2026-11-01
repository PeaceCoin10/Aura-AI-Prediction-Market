#!/usr/bin/env python3
"""
Minimal DeepSeek chat client (stdlib only).

The key is never stored in the repository: it is read from `DEEPSEEK_API_KEY` or from a
0600 file outside the working tree (default `~/.aura/deepseek.key`). Every call is a real
HTTPS request to `api.deepseek.com`; there is no mock path in production code, only in tests.

Usage:
    from deepseek import chat, DeepSeekError
    text = chat([{"role": "user", "content": "hi"}], json_mode=True)
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.deepseek.com/chat/completions"
DEFAULT_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
KEY_FILE = Path(os.environ.get("DEEPSEEK_KEY_FILE", str(Path.home() / ".aura" / "deepseek.key")))
TIMEOUT = float(os.environ.get("DEEPSEEK_TIMEOUT", "90"))


class DeepSeekError(RuntimeError):
    """Any failure that means 'no usable answer from the model'."""


def api_key() -> str:
    key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if key:
        return key
    try:
        key = KEY_FILE.read_text().strip()
    except OSError as exc:
        raise DeepSeekError(f"no API key: set DEEPSEEK_API_KEY or write {KEY_FILE} ({exc})") from exc
    if not key:
        raise DeepSeekError(f"empty API key in {KEY_FILE}")
    return key


def chat(
    messages: list[dict],
    model: str = DEFAULT_MODEL,
    temperature: float = 0.4,
    max_tokens: int = 1200,
    json_mode: bool = False,
    retries: int = 3,
) -> str:
    """One completion. Retries 429/5xx and network errors with exponential backoff."""
    body: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    payload = json.dumps(body).encode()
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key()}",
        "Accept": "application/json",
    }

    last: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(API, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = json.loads(resp.read().decode())
            break
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode()[:300] if exc.fp else ""
            last = DeepSeekError(f"HTTP {exc.code}: {detail}")
            if exc.code in (429, 500, 502, 503, 504) and attempt + 1 < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise last from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = DeepSeekError(f"transport: {exc}")
            if attempt + 1 < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise last from exc
    else:  # pragma: no cover - loop always breaks or raises
        raise last or DeepSeekError("no response")

    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise DeepSeekError(f"unexpected response shape: {str(data)[:200]}") from exc
