#!/usr/bin/env python3
"""
hermes_agent.py -- root entry point, equivalent to `python3 hermes/hermes_brain.py`.

The implementation lives in `hermes/hermes_brain.py` (Creator / Marketing / Oracle engines plus offline unit tests).
This shim exists so that `python3 hermes_agent.py --once` is convenient to type.

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
