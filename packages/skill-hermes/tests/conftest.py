"""Shared fixtures + cross-language JS bridge helpers.

SPEC 03-modules-product §4 requires wire-layer equivalence with the
TS Skill, so several tests spawn Node and compare output against
@agentxp/protocol. The bridge is skipped (rather than failed) when
the TS packages have not been built yet — we only want CI to catch
divergence, not a missing `dist/` directory.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
PROTOCOL_DIST = REPO_ROOT / "packages" / "protocol" / "dist" / "index.js"


def _protocol_available() -> bool:
    return PROTOCOL_DIST.exists()


@pytest.fixture
def repo_root() -> Path:
    return REPO_ROOT


@pytest.fixture
def protocol_or_skip() -> Path:
    if not _protocol_available():
        pytest.skip(f"@agentxp/protocol not built: {PROTOCOL_DIST}")
    return PROTOCOL_DIST


def run_node(script: str, stdin: str = "") -> str:
    """Run a short Node script with CWD = REPO_ROOT so @agentxp/* resolves."""
    env = os.environ.copy()
    res = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=str(REPO_ROOT),
        input=stdin.encode("utf-8"),
        capture_output=True,
        env=env,
        timeout=30,
    )
    if res.returncode != 0:
        raise RuntimeError(
            f"node failed (code={res.returncode}):\nstdout={res.stdout.decode()}\nstderr={res.stderr.decode()}"
        )
    return res.stdout.decode("utf-8")


def js_canonicalize(event: dict) -> str:
    """Ask @agentxp/protocol to canonicalize the given event."""
    script = (
        "import { canonicalize } from '@agentxp/protocol';"
        "let s='';process.stdin.on('data',d=>s+=d);"
        "process.stdin.on('end',()=>{const e=JSON.parse(s);process.stdout.write(canonicalize(e));});"
    )
    return run_node(script, json.dumps(event))


def js_verify_event(event: dict) -> bool:
    script = (
        "import { verifyEvent } from '@agentxp/protocol';"
        "let s='';process.stdin.on('data',d=>s+=d);"
        "process.stdin.on('end',async()=>{const e=JSON.parse(s);const ok=await verifyEvent(e);"
        "process.stdout.write(ok?'true':'false');});"
    )
    return run_node(script, json.dumps(event)).strip() == "true"
