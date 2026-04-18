"""Canonical byte sequence + SHA-256 event id.

Matches ADR-003 D1 exactly: recursively sorted-keys, whitespace-free
JSON over the envelope with `id` and `sig` removed. Output MUST be
byte-identical to @serendip/protocol's `canonicalize` so that any
signed event produced here verifies under the TypeScript verifier.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

_EXCLUDED_KEYS = frozenset({"id", "sig"})


def _sorted_json(value: Any) -> str:
    # Primitives route through json.dumps with ensure_ascii=False; JS
    # JSON.stringify leaves non-ASCII characters unescaped, so Python
    # must follow suit to keep the byte sequence identical.
    if value is None or isinstance(value, bool) or isinstance(value, (int, float, str)):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(_sorted_json(v) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value.keys())
        pairs = [json.dumps(k, ensure_ascii=False) + ":" + _sorted_json(value[k]) for k in keys]
        return "{" + ",".join(pairs) + "}"
    raise TypeError(f"canonical: unsupported type {type(value).__name__}")


def canonicalize(event: dict[str, Any]) -> str:
    """Return the canonical UTF-8 string for an event envelope.

    `id` and `sig` are stripped from the top level only; nested
    objects are passed through untouched (keys sorted at every depth).
    """
    filtered = {k: v for k, v in event.items() if k not in _EXCLUDED_KEYS}
    return _sorted_json(filtered)


def sha256_hex(text: str) -> str:
    """SHA-256 of the UTF-8 bytes of `text`, lowercase hex."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
