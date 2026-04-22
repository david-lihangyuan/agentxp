"""Publish staged drafts to a relay (SPEC 01-interfaces §5.1, §6).

Mirrors `packages/skill/src/publisher.ts`:
- 15-minute base backoff with 60-minute cap, matching the Skill SKU
  retry contract (SPEC 01-interfaces §6).
- Drafts are removed only on 200 OK or a non-retryable 4xx.
"""

from __future__ import annotations

import json
import random as _random
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Literal, Optional

from .drafts import DraftRow, DraftStore
from .events import create_event, sign_event
from .keys import AgentKey

_BASE_SECONDS = 15 * 60
_CAP_SECONDS = 60 * 60
_JITTER_RATIO = 0.2

Status = Literal["published", "retry", "rejected"]


@dataclass
class PublishResult:
    draft_id: int
    status: Status
    http_status: Optional[int]
    event_id: Optional[str] = None
    error: Optional[str] = None


def next_attempt_delay(retry_count: int, rng: Optional[Callable[[], float]] = None) -> int:
    r = rng if rng is not None else _random.random
    raw = min(_BASE_SECONDS * (2 ** max(0, retry_count)), _CAP_SECONDS)
    jitter = raw * _JITTER_RATIO * (r() * 2 - 1)
    return max(1, int(raw + jitter))


def _is_retryable(status: int) -> bool:
    return status == 429 or status >= 500


def _draft_to_event(draft: DraftRow, agent: AgentKey) -> dict[str, Any]:
    payload: dict[str, Any] = {"type": "experience", "data": draft.data}
    envelope = create_event("intent.broadcast", payload, draft.tags, draft.created_at)
    return sign_event(envelope, agent)


# The Skill tests inject a fetch-like callable (``(url, options) ->
# Response``). We keep the same contract for Python so unit tests can
# swap in an in-process double instead of real HTTP.
FetchLike = Callable[[str, dict[str, Any]], "FetchResponse"]


@dataclass
class FetchResponse:
    status: int
    body: bytes

    def json(self) -> dict[str, Any]:
        try:
            return json.loads(self.body.decode("utf-8"))
        except Exception:
            return {}


def _default_fetch(url: str, options: dict[str, Any]) -> FetchResponse:
    req = urllib.request.Request(
        url,
        data=options.get("body"),
        method=options.get("method", "GET"),
        headers=options.get("headers", {}),
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return FetchResponse(status=resp.status, body=resp.read())
    except urllib.error.HTTPError as e:
        return FetchResponse(status=e.code, body=e.read())


def publish_drafts(
    relay_url: str,
    agent: AgentKey,
    store: DraftStore,
    fetch: Optional[FetchLike] = None,
    now: Optional[Callable[[], int]] = None,
) -> list[PublishResult]:
    fetch_impl = fetch if fetch is not None else _default_fetch
    now_fn = now if now is not None else (lambda: int(time.time()))
    results: list[PublishResult] = []

    endpoint = relay_url.rstrip("/") + "/api/v1/events"
    for draft in store.list_due(now_fn()):
        signed = _draft_to_event(draft, agent)
        body = json.dumps({"event": signed}).encode("utf-8")
        try:
            res = fetch_impl(
                endpoint,
                {
                    "method": "POST",
                    "headers": {"content-type": "application/json"},
                    "body": body,
                },
            )
        except Exception as err:
            delay = next_attempt_delay(draft.retry_count + 1)
            store.mark_attempt(draft.id, now_fn(), now_fn() + delay)
            results.append(
                PublishResult(
                    draft_id=draft.id,
                    status="retry",
                    http_status=None,
                    error=str(err),
                )
            )
            continue

        if res.status == 200:
            store.remove(draft.id)
            results.append(
                PublishResult(
                    draft_id=draft.id,
                    status="published",
                    http_status=200,
                    event_id=signed["id"],
                )
            )
            continue

        body_json = res.json()
        err_msg = body_json.get("error") if isinstance(body_json, dict) else None
        if _is_retryable(res.status):
            delay = next_attempt_delay(draft.retry_count + 1)
            store.mark_attempt(draft.id, now_fn(), now_fn() + delay)
            results.append(
                PublishResult(
                    draft_id=draft.id,
                    status="retry",
                    http_status=res.status,
                    error=err_msg,
                )
            )
        else:
            store.remove(draft.id)
            results.append(
                PublishResult(
                    draft_id=draft.id,
                    status="rejected",
                    http_status=res.status,
                    error=err_msg,
                )
            )

    return results
