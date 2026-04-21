"""Tier-1 capture + Tier-2 reflect orchestration (ADR-001).

Mirrors `packages/skill/src/reflect.ts`: both tiers share the same
event schema and go through local staging; Tier-2 is the publish
cycle. The Python port additionally enforces byte-count parity with
the TS reference via `events.sign_event` (§4 acceptance 3).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from .drafts import DraftRow, DraftStore, Tier
from .identity import ensure_agent_key, load_operator_key
from .publisher import FetchLike, PublishResult, publish_drafts

_OUTCOMES = frozenset({"succeeded", "failed", "partial", "inconclusive"})


class DraftValidationError(ValueError):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


@dataclass
class DraftInput:
    what: str
    tried: str
    outcome: str
    learned: str
    tags: Optional[list[str]] = None
    scope: Optional[dict[str, Any]] = None


def _validate(draft: DraftInput) -> dict[str, Any]:
    if not draft.what.strip():
        raise DraftValidationError("what", "what is required")
    if not draft.tried.strip():
        raise DraftValidationError("tried", "tried is required")
    if not draft.learned.strip():
        raise DraftValidationError("learned", "learned is required")
    if draft.outcome not in _OUTCOMES:
        raise DraftValidationError(
            "outcome", f"outcome must be one of {'|'.join(sorted(_OUTCOMES))}"
        )
    data: dict[str, Any] = {
        "what": draft.what,
        "tried": draft.tried,
        "outcome": draft.outcome,
        "learned": draft.learned,
    }
    if draft.scope is not None:
        data["scope"] = draft.scope
    return data


def capture_in_session_draft(store: DraftStore, draft: DraftInput) -> DraftRow:
    data = _validate(draft)
    return store.add("in-session", data, draft.tags or [])


def capture_end_of_session_draft(store: DraftStore, draft: DraftInput) -> DraftRow:
    data = _validate(draft)
    return store.add("end-of-session", data, draft.tags or [])


@dataclass
class SkillConfig:
    relay_url: str
    agent_id: str


def _load_config(target_dir: Path) -> SkillConfig:
    path = target_dir / ".agentxp" / "config.json"
    if not path.exists():
        return SkillConfig(relay_url="http://localhost:3141", agent_id="default")
    raw = json.loads(path.read_text())
    return SkillConfig(relay_url=raw["relay_url"], agent_id=raw["agent_id"])


def open_store_for_target(target_dir: Path) -> DraftStore:
    workspace = target_dir / ".agentxp"
    workspace.mkdir(parents=True, exist_ok=True)
    return DraftStore(str(workspace / "drafts.sqlite"))


@dataclass
class ReflectOutcome:
    published: list[PublishResult]
    retry: list[PublishResult]
    rejected: list[PublishResult]


def reflect(
    target_dir: Path | str,
    identity_root: Optional[Path | str] = None,
    fetch: Optional[FetchLike] = None,
    now: Optional[Callable[[], int]] = None,
) -> ReflectOutcome:
    target = Path(target_dir)
    config = _load_config(target)
    # Identity check first: users hit "operator key not found" rather
    # than a SQLite surprise when identity is missing.
    operator = load_operator_key(identity_root)
    agent = ensure_agent_key(operator, config.agent_id, 30, identity_root)
    store = open_store_for_target(target)
    try:
        results = publish_drafts(
            relay_url=config.relay_url,
            agent=agent,
            store=store,
            fetch=fetch,
            now=now,
        )
    finally:
        store.close()
    return ReflectOutcome(
        published=[r for r in results if r.status == "published"],
        retry=[r for r in results if r.status == "retry"],
        rejected=[r for r in results if r.status == "rejected"],
    )
