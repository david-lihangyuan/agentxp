"""Canonical serialisation parity with @serendip/protocol (ADR-003 D1)."""

from __future__ import annotations

from agentxp_skill_hermes.canonical import canonicalize, sha256_hex

from .conftest import js_canonicalize


class TestCanonicalize:
    def test_strips_id_and_sig_and_sorts_keys(self) -> None:
        event = {
            "v": 1,
            "kind": "intent.broadcast",
            "created_at": 1700000000,
            "pubkey": "a" * 64,
            "payload": {"type": "experience", "data": {"b": 1, "a": 2}},
            "tags": ["x", "y"],
            "visibility": "public",
            "operator_pubkey": "b" * 64,
            "id": "deadbeef",
            "sig": "cafebabe",
        }
        out = canonicalize(event)
        assert "deadbeef" not in out
        assert "cafebabe" not in out
        # top-level key order is lexicographic
        assert out.startswith('{"created_at":')
        # nested key sort: "a" before "b" inside payload.data
        assert '"data":{"a":2,"b":1}' in out

    def test_non_ascii_is_not_escaped(self) -> None:
        # JS JSON.stringify leaves "中" unescaped; Python must match.
        out = canonicalize({"kind": "intent.broadcast", "payload": {"q": "中"}})
        assert '"中"' in out
        assert "\\u4e2d" not in out

    def test_matches_js_canonicalize_byte_for_byte(self) -> None:
        event = {
            "v": 1,
            "kind": "intent.broadcast",
            "created_at": 1733000000,
            "pubkey": "a" * 64,
            "operator_pubkey": "b" * 64,
            "payload": {
                "type": "experience",
                "data": {
                    "what": "sample",
                    "tried": "a",
                    "outcome": "succeeded",
                    "learned": "π is not 3",
                    "scope": {"versions": ["v1", "v2"], "context": "测试"},
                },
            },
            "tags": ["skill", "m6"],
            "visibility": "public",
        }
        assert canonicalize(event) == js_canonicalize(event)


class TestSha256Hex:
    def test_known_vector(self) -> None:
        # RFC 6234 test vector: sha256("abc") == "ba7816bf..."
        assert sha256_hex("abc") == (
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
