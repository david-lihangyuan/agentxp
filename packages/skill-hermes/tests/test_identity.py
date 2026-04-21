"""Cross-SKU identity compatibility (SPEC §4 acceptance 2).

The file layout MUST match `packages/skill/src/identity.ts` so a
Python-written operator.json is readable by TS and vice-versa.
"""

from __future__ import annotations

import json
from pathlib import Path

from agentxp_skill_hermes.identity import (
    OperatorKeyMissingError,
    ensure_agent_key,
    ensure_operator_key,
    load_operator_key,
    resolve_identity_paths,
)
from agentxp_skill_hermes.keys import generate_operator_key


class TestOperatorKey:
    def test_ensure_creates_file_with_expected_schema(self, tmp_path: Path) -> None:
        op = ensure_operator_key(tmp_path)
        raw = json.loads((tmp_path / "operator.json").read_text())
        assert raw["publicKey"] == op.public_key
        assert raw["privateKey"] == op.private_key.hex()
        assert isinstance(raw["created_at"], int)

    def test_ensure_is_idempotent(self, tmp_path: Path) -> None:
        first = ensure_operator_key(tmp_path)
        second = ensure_operator_key(tmp_path)
        assert first.public_key == second.public_key
        assert first.private_key == second.private_key

    def test_load_raises_when_absent(self, tmp_path: Path) -> None:
        import pytest

        with pytest.raises(OperatorKeyMissingError):
            load_operator_key(tmp_path)

    def test_ts_written_file_is_readable_by_hermes(self, tmp_path: Path) -> None:
        """SPEC §4 acceptance 2: identical identity file shape."""
        op = generate_operator_key()
        # Write using the exact TS on-disk schema (publicKey,
        # privateKey, created_at camelCase for the two key fields).
        (tmp_path / "operator.json").write_text(
            json.dumps(
                {
                    "publicKey": op.public_key,
                    "privateKey": op.private_key.hex(),
                    "created_at": 1700000000,
                }
            )
        )
        loaded = load_operator_key(tmp_path)
        assert loaded.public_key == op.public_key
        assert loaded.private_key == op.private_key


class TestAgentKey:
    def test_ensure_writes_and_reuses_agent_key(self, tmp_path: Path) -> None:
        op = ensure_operator_key(tmp_path)
        first = ensure_agent_key(op, "hermes", 30, tmp_path)
        second = ensure_agent_key(op, "hermes", 30, tmp_path)
        assert first.public_key == second.public_key
        assert first.delegated_by == op.public_key

        raw = json.loads((tmp_path / "agent.json").read_text())
        assert raw["publicKey"] == first.public_key
        assert raw["delegatedBy"] == op.public_key
        assert raw["agentId"] == "hermes"

    def test_paths(self, tmp_path: Path) -> None:
        paths = resolve_identity_paths(tmp_path)
        assert paths.root == tmp_path
        assert paths.operator_file == tmp_path / "operator.json"
        assert paths.agent_file == tmp_path / "agent.json"
