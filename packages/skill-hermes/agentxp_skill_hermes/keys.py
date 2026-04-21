"""Ed25519 operator + agent key primitives.

Mirrors `packages/protocol/src/keys.ts` — the on-disk record
carries the 32-byte Ed25519 seed (hex-encoded), and the public key is
derived via `SigningKey(seed).verify_key`.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Optional

import nacl.signing

_SECONDS_PER_DAY = 86_400


@dataclass(frozen=True)
class OperatorKey:
    public_key: str
    private_key: bytes  # 32-byte seed


@dataclass(frozen=True)
class AgentKey:
    public_key: str
    private_key: bytes
    delegated_by: str
    expires_at: int
    agent_id: Optional[str] = None


def generate_operator_key() -> OperatorKey:
    seed = os.urandom(32)
    verify = nacl.signing.SigningKey(seed).verify_key
    return OperatorKey(public_key=verify.encode().hex(), private_key=seed)


def delegate_agent_key(operator: OperatorKey, agent_id: str, ttl_days: int) -> AgentKey:
    seed = os.urandom(32)
    verify = nacl.signing.SigningKey(seed).verify_key
    expires = int(time.time()) + ttl_days * _SECONDS_PER_DAY
    return AgentKey(
        public_key=verify.encode().hex(),
        private_key=seed,
        delegated_by=operator.public_key,
        expires_at=expires,
        agent_id=agent_id,
    )


def sign_bytes(seed: bytes, message: bytes) -> bytes:
    """Ed25519 signature over `message` under the 32-byte seed."""
    return nacl.signing.SigningKey(seed).sign(message).signature


def verify_bytes(public_key_hex: str, message: bytes, signature: bytes) -> bool:
    try:
        nacl.signing.VerifyKey(bytes.fromhex(public_key_hex)).verify(message, signature)
        return True
    except Exception:
        return False
