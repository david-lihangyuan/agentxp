"""Sign/verify roundtrip + SPEC §4 acceptance cases 1 and 3."""

from __future__ import annotations

import json

import pytest

from agentxp_skill_hermes.events import (
    CanonicalMismatchError,
    InvalidKindError,
    MAX_PAYLOAD_BYTES,
    PayloadTooLargeError,
    create_event,
    sign_event,
    verify_event,
)
from agentxp_skill_hermes.keys import delegate_agent_key, generate_operator_key

from .conftest import js_verify_event


def _fixture_agent():
    op = generate_operator_key()
    return delegate_agent_key(op, "test-agent", ttl_days=30)


class TestSignVerify:
    def test_roundtrip(self) -> None:
        agent = _fixture_agent()
        envelope = create_event(
            "intent.broadcast",
            {
                "type": "experience",
                "data": {
                    "what": "w", "tried": "t", "outcome": "succeeded", "learned": "l",
                },
            },
            tags=["a", "b"],
            created_at=1700000000,
        )
        signed = sign_event(envelope, agent)
        assert len(signed["id"]) == 64
        assert len(signed["sig"]) == 128
        assert signed["pubkey"] == agent.public_key
        assert signed["operator_pubkey"] == agent.delegated_by
        assert verify_event(signed) is True

    def test_tamper_detection(self) -> None:
        agent = _fixture_agent()
        signed = sign_event(
            create_event("intent.broadcast", {"type": "experience", "data": {
                "what": "w", "tried": "t", "outcome": "succeeded", "learned": "l",
            }}, []),
            agent,
        )
        tampered = {**signed, "tags": ["mutated"]}
        assert verify_event(tampered) is False

    def test_js_accepts_python_signed_event(self, protocol_or_skip) -> None:
        """SPEC §4 acceptance 1: Python-signed events pass verifyEvent."""
        agent = _fixture_agent()
        signed = sign_event(
            create_event(
                "intent.broadcast",
                {"type": "experience", "data": {
                    "what": "hello", "tried": "a", "outcome": "succeeded", "learned": "b",
                }},
                ["m6"],
                created_at=1733000000,
            ),
            agent,
        )
        assert js_verify_event(signed) is True


class TestErrors:
    def test_payload_too_large(self) -> None:
        agent = _fixture_agent()
        big = "x" * (MAX_PAYLOAD_BYTES + 100)
        envelope = create_event(
            "intent.broadcast",
            {"type": "experience", "data": {
                "what": big, "tried": "t", "outcome": "succeeded", "learned": "l",
            }},
            [],
        )
        with pytest.raises(PayloadTooLargeError) as exc:
            sign_event(envelope, agent)
        assert exc.value.actual > MAX_PAYLOAD_BYTES

    def test_invalid_kind(self) -> None:
        with pytest.raises(InvalidKindError):
            create_event("intent.bogus", {"type": "x", "data": {}}, [])  # type: ignore[arg-type]

    def test_self_check_raises_on_pipeline_corruption(self, monkeypatch) -> None:
        """SPEC §4 acceptance 3: typed exception when the signing
        pipeline produces an event that fails local re-verification.

        We inject corruption by forcing the Ed25519 signer to return
        a garbage signature; this is the same observable failure any
        canonical-form divergence between sign and verify would
        produce, and is the pre-emit guarantee the spec demands.
        """
        import agentxp_skill_hermes.events as ev_mod

        monkeypatch.setattr(ev_mod, "sign_bytes", lambda seed, msg: b"\x00" * 64)
        agent = _fixture_agent()
        envelope = create_event(
            "intent.broadcast",
            {"type": "experience", "data": {
                "what": "w", "tried": "t", "outcome": "succeeded", "learned": "l",
            }},
            [],
        )
        with pytest.raises(CanonicalMismatchError):
            sign_event(envelope, agent)
