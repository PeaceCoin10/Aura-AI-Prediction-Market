#!/usr/bin/env python3
"""
hermes_agent.py —— 根目录入口，等价于 `python3 hermes/hermes_brain.py`。

真正的实现在 `hermes/hermes_brain.py`（含 Creator / Marketing / Oracle 三个引擎与离线单测）。
放在根目录只是为了 `python3 hermes_agent.py --once` 这种顺手写法。

    export RPC_URL=https://sepolia.base.org ENGINE=0x... USDC=0x... BRAIN_PK=0x...
    python3 hermes_agent.py --once --dry-run
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "hermes"))

from hermes_brain import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
