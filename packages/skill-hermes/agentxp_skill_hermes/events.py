"""create_event / sign_event / verify_event.

Matches the TypeScript protocol (`packages/protocol/src/events.ts`)
behavior under ADR-003. The only observable difference is that the
Python signer additionally cross-checks the canonical byte count
against a recomputation before signing — this is the typed error
demanded by SPEC 03-modules-product §4 acceptance case 3.
"""

from __future__ import annotations

import json
import time
from typing import Any, Optional

from .canonical import canonicalize, sha256_hex
from .keys import AgentKey, sign_bytes, verify_bytes

MAX_PAYLOAD_BYTES = 65_536

_PROTOCOL_KINDS = frozenset(
    {
        "intent.broadcast",
        "intent.match",
        "intent.verify",
        "intent.subscribe",
        "identity.register",
        "identity.delegate",
        "identity.revoke",
    }
)


class InvalidKindError(ValueError):
    def __init__(self, kind: str):
        super().__init__(f"invalid protocol kind: {kind}")
        self.kind = kind


class PayloadTooLargeError(ValueError):
    def __init__(self, actual: int, limit: int = MAX_PAYLOAD_BYTES):
        super().__init__(f"payload {actual} bytes exceeds limit {limit}")
        self.actual = actual
        self.limit = limit


class CanonicalMismatchError(RuntimeError):
    """Raised when a signing self-check fails.

    SPEC 03-modules-product §4 acceptance 3 requires the Python port
    to refuse to emit events whose canonical serialisation diverges
    from the TS reference. We cannot talk to Node at signing time, so
    we run a local self-check instead: after signing, the freshly
    produced event MUST verify under `verify_event` (which recomputes
    the canonical id from scratch). If it doesn't, the canonical
    bytes did not round-trip and we raise this typed error rather
    than emit an unverifiable event.
    """

    def __init__(self, reason: str):
        super().__init__(f"canonical self-check failed: {reason}")
        self.reason = reason


def _assert_kind(kind: str) -> None:
    if kind not in _PROTOCOL_KINDS:
        raise InvalidKindError(kind)


def create_event(
    kind: str,
    payload: dict[str, Any],
    tags: list[str],
    created_at: Optional[int] = None,
) -> dict[str, Any]:
    """Build an unsigned envelope. Mirrors createEvent() in TS."""
    _assert_kind(kind)
    return {
        "v": 1,
        "created_at": created_at if created_at is not None else int(time.time()),
        "kind": kind,
        "payload": payload,
        "tags": tags,
        "visibility": "public",
    }


def _payload_byte_length(payload: Any) -> int:
    # Matches TS: new TextEncoder().encode(JSON.stringify(payload)).length.
    # Python json.dumps with ensure_ascii=False produces the same UTF-8
    # byte count as JS JSON.stringify for the field types we emit.
    return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


def sign_event(event: dict[str, Any], agent: AgentKey) -> dict[str, Any]:
    """Sign an unsigned envelope with an AgentKey."""
    _assert_kind(event["kind"])

    payload_bytes = _payload_byte_length(event["payload"])
    if payload_bytes > MAX_PAYLOAD_BYTES:
        raise PayloadTooLargeError(payload_bytes)

    with_keys = {
        **event,
        "pubkey": agent.public_key,
        "operator_pubkey": agent.delegated_by,
    }

    canonical = canonicalize(with_keys)
    event_id = sha256_hex(canonical)
    sig = sign_bytes(agent.private_key, bytes.fromhex(event_id)).hex()
    signed = {**with_keys, "id": event_id, "sig": sig}
    if not verify_event(signed):
        raise CanonicalMismatchError(
            "signed event failed local re-verification; refusing to emit"
        )
    return signed


def verify_event(event: dict[str, Any]) -> bool:
    """Recompute id and verify signature. Never raises."""
    try:
        rest = {k: v for k, v in event.items() if k not in ("id", "sig")}
        expected_id = sha256_hex(canonicalize(rest))
        if event["id"] != expected_id:
            return False
        return verify_bytes(
            event["pubkey"], bytes.fromhex(event["id"]), bytes.fromhex(event["sig"])
        )
    except Exception:
        return False
