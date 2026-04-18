"""On-disk identity material.

Matches `src/packages/skill/src/identity.ts` byte-for-byte at the file
layer: operator.json / agent.json with hex-encoded 32-byte seeds.
SPEC 03-modules-product §4 acceptance 2: running Skill-Hermes against
the same identity directory as Skill MUST produce events attributable
to the same operator_pubkey.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .keys import AgentKey, OperatorKey, delegate_agent_key, generate_operator_key


class OperatorKeyMissingError(FileNotFoundError):
    pass


@dataclass(frozen=True)
class IdentityPaths:
    root: Path
    operator_file: Path
    agent_file: Path


def _default_root() -> Path:
    return Path.home() / ".agentxp" / "identity"


def resolve_identity_paths(root: Optional[Path | str] = None) -> IdentityPaths:
    r = Path(root) if root is not None else _default_root()
    return IdentityPaths(
        root=r,
        operator_file=r / "operator.json",
        agent_file=r / "agent.json",
    )


def _write_private(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2))
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def ensure_operator_key(root: Optional[Path | str] = None) -> OperatorKey:
    paths = resolve_identity_paths(root)
    paths.root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if paths.operator_file.exists():
        raw = json.loads(paths.operator_file.read_text())
        return OperatorKey(public_key=raw["publicKey"], private_key=bytes.fromhex(raw["privateKey"]))
    op = generate_operator_key()
    _write_private(
        paths.operator_file,
        {
            "publicKey": op.public_key,
            "privateKey": op.private_key.hex(),
            "created_at": int(time.time()),
        },
    )
    return op


def load_operator_key(root: Optional[Path | str] = None) -> OperatorKey:
    paths = resolve_identity_paths(root)
    if not paths.operator_file.exists():
        raise OperatorKeyMissingError(f"operator key not found at {paths.operator_file}")
    raw = json.loads(paths.operator_file.read_text())
    return OperatorKey(public_key=raw["publicKey"], private_key=bytes.fromhex(raw["privateKey"]))


def ensure_agent_key(
    operator: OperatorKey,
    agent_id: str,
    ttl_days: int,
    root: Optional[Path | str] = None,
) -> AgentKey:
    paths = resolve_identity_paths(root)
    paths.root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if paths.agent_file.exists():
        raw = json.loads(paths.agent_file.read_text())
        # Mirror the TS 1-hour buffer before rolling the agent key.
        if raw["expiresAt"] > int(time.time()) + 3600:
            return AgentKey(
                public_key=raw["publicKey"],
                private_key=bytes.fromhex(raw["privateKey"]),
                delegated_by=raw["delegatedBy"],
                expires_at=raw["expiresAt"],
                agent_id=raw.get("agentId", agent_id),
            )
    agent = delegate_agent_key(operator, agent_id, ttl_days)
    _write_private(
        paths.agent_file,
        {
            "publicKey": agent.public_key,
            "privateKey": agent.private_key.hex(),
            "delegatedBy": agent.delegated_by,
            "expiresAt": agent.expires_at,
            "agentId": agent.agent_id or agent_id,
        },
    )
    return agent
