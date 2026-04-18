"""Capture + reflect + CLI orchestration tests."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from agentxp_skill_hermes.cli import run as cli_run
from agentxp_skill_hermes.identity import ensure_operator_key
from agentxp_skill_hermes.init import init_workspace
from agentxp_skill_hermes.publisher import FetchResponse
from agentxp_skill_hermes.reflect import (
    DraftInput,
    DraftValidationError,
    capture_end_of_session_draft,
    capture_in_session_draft,
    open_store_for_target,
    reflect,
)


class TestCapture:
    def test_in_session_captures_a_draft(self, tmp_path: Path) -> None:
        init_workspace(tmp_path, identity_root=tmp_path / "id")
        store = open_store_for_target(tmp_path)
        try:
            row = capture_in_session_draft(
                store,
                DraftInput(
                    what="w", tried="t", outcome="succeeded", learned="l", tags=["a"]
                ),
            )
            assert row.tier == "in-session"
            assert row.data["outcome"] == "succeeded"
            assert row.tags == ["a"]
        finally:
            store.close()

    def test_validation_errors_report_field(self, tmp_path: Path) -> None:
        store = open_store_for_target(tmp_path)
        try:
            with pytest.raises(DraftValidationError) as exc:
                capture_in_session_draft(
                    store,
                    DraftInput(what=" ", tried="t", outcome="succeeded", learned="l"),
                )
            assert exc.value.field == "what"
        finally:
            store.close()

    def test_invalid_outcome_is_rejected(self, tmp_path: Path) -> None:
        store = open_store_for_target(tmp_path)
        try:
            with pytest.raises(DraftValidationError) as exc:
                capture_end_of_session_draft(
                    store,
                    DraftInput(what="w", tried="t", outcome="maybe", learned="l"),  # type: ignore[arg-type]
                )
            assert exc.value.field == "outcome"
        finally:
            store.close()


def _fake_fetch(status: int, body: dict | None = None):
    payload = json.dumps(body or {}).encode("utf-8")
    calls: list[tuple[str, dict]] = []

    def fetch(url: str, options: dict) -> FetchResponse:
        calls.append((url, options))
        return FetchResponse(status=status, body=payload)

    fetch.calls = calls  # type: ignore[attr-defined]
    return fetch


class TestReflect:
    def _seed(self, tmp_path: Path) -> Path:
        """Return a project dir with skill workspace + staged draft."""
        init_workspace(tmp_path, identity_root=tmp_path / "id")
        # Point the config at a deterministic relay URL so the mock
        # captures requests against it.
        (tmp_path / ".agentxp" / "config.json").write_text(
            json.dumps({"relay_url": "http://relay.test", "agent_id": "hermes"})
        )
        store = open_store_for_target(tmp_path)
        try:
            capture_end_of_session_draft(
                store,
                DraftInput(what="w", tried="t", outcome="succeeded", learned="l"),
            )
        finally:
            store.close()
        return tmp_path

    def test_publishes_draft_on_200(self, tmp_path: Path) -> None:
        target = self._seed(tmp_path)
        fetch = _fake_fetch(200, {})
        outcome = reflect(target, identity_root=tmp_path / "id", fetch=fetch)
        assert len(outcome.published) == 1
        assert outcome.published[0].event_id is not None
        assert fetch.calls[0][0].endswith("/api/v1/events")
        # Draft table should be empty after a successful publish.
        db = sqlite3.connect(str(target / ".agentxp" / "drafts.sqlite"))
        try:
            assert db.execute("SELECT COUNT(*) FROM drafts").fetchone()[0] == 0
        finally:
            db.close()

    def test_retries_on_503_and_retains_draft(self, tmp_path: Path) -> None:
        target = self._seed(tmp_path)
        fetch = _fake_fetch(503, {"error": "service_unavailable"})
        outcome = reflect(target, identity_root=tmp_path / "id", fetch=fetch)
        assert len(outcome.retry) == 1
        db = sqlite3.connect(str(target / ".agentxp" / "drafts.sqlite"))
        try:
            assert db.execute("SELECT COUNT(*) FROM drafts").fetchone()[0] == 1
        finally:
            db.close()

    def test_rejects_on_400_and_removes_draft(self, tmp_path: Path) -> None:
        target = self._seed(tmp_path)
        fetch = _fake_fetch(400, {"error": "bad_payload"})
        outcome = reflect(target, identity_root=tmp_path / "id", fetch=fetch)
        assert len(outcome.rejected) == 1
        db = sqlite3.connect(str(target / ".agentxp" / "drafts.sqlite"))
        try:
            assert db.execute("SELECT COUNT(*) FROM drafts").fetchone()[0] == 0
        finally:
            db.close()


class TestCli:
    def test_init_then_capture(self, tmp_path: Path, monkeypatch) -> None:
        monkeypatch.setenv("HOME", str(tmp_path / "home"))
        code = cli_run(["init", "--dir", str(tmp_path / "ws")])
        assert code == 0
        assert (tmp_path / "ws" / "SKILL.md").exists()
        code = cli_run([
            "capture", "--dir", str(tmp_path / "ws"),
            "--what", "hello", "--tried", "sat", "--outcome", "succeeded",
            "--learned", "learned",
        ])
        assert code == 0

    def test_missing_identity_reports_clean_error(
        self, tmp_path: Path, capsys, monkeypatch
    ) -> None:
        monkeypatch.setenv("HOME", str(tmp_path / "home-empty"))
        (tmp_path / "ws").mkdir()
        (tmp_path / "ws" / ".agentxp").mkdir()
        (tmp_path / "ws" / ".agentxp" / "config.json").write_text(
            json.dumps({"relay_url": "http://relay.test", "agent_id": "x"})
        )
        code = cli_run(["reflect", "--dir", str(tmp_path / "ws")])
        assert code == 1
        err = capsys.readouterr().err
        assert "operator key not found" in err
