"""Local draft staging (02-data-model §7.1).

Same SQLite schema as `@agentxp/skill` so the two SKUs write
interoperable drafts into the same project workspace. `listDue` is
ordered by `created_at` to preserve publish order across restarts.
"""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from typing import Any, Literal, Optional

Tier = Literal["in-session", "end-of-session"]


@dataclass
class DraftRow:
    id: int
    tier: Tier
    data: dict[str, Any]
    tags: list[str]
    created_at: int
    retry_count: int
    last_attempt: Optional[int]
    next_attempt_at: int


class DraftStore:
    def __init__(self, db_path: str):
        # `check_same_thread=False` keeps pytest's threading model
        # happy; the CLI is single-threaded so there is no contention.
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._db.execute("PRAGMA journal_mode = WAL")
        self._db.executescript(
            """
            CREATE TABLE IF NOT EXISTS drafts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tier TEXT NOT NULL CHECK(tier IN ('in-session','end-of-session')),
                data_json TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                retry_count INTEGER NOT NULL DEFAULT 0,
                last_attempt INTEGER,
                next_attempt_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_drafts_due ON drafts(next_attempt_at);
            """
        )

    @staticmethod
    def _row(cur_row: tuple) -> DraftRow:
        return DraftRow(
            id=cur_row[0],
            tier=cur_row[1],
            data=json.loads(cur_row[2]),
            tags=json.loads(cur_row[3]),
            created_at=cur_row[4],
            retry_count=cur_row[5],
            last_attempt=cur_row[6],
            next_attempt_at=cur_row[7],
        )

    def add(
        self,
        tier: Tier,
        data: dict[str, Any],
        tags: list[str],
        created_at: Optional[int] = None,
    ) -> DraftRow:
        ts = created_at if created_at is not None else int(time.time())
        cur = self._db.execute(
            "INSERT INTO drafts (tier, data_json, tags_json, created_at, next_attempt_at) "
            "VALUES (?, ?, ?, ?, ?) RETURNING *",
            (tier, json.dumps(data), json.dumps(tags), ts, ts),
        )
        row = cur.fetchone()
        self._db.commit()
        return self._row(row)

    def list_due(self, now: Optional[int] = None) -> list[DraftRow]:
        ts = now if now is not None else int(time.time())
        cur = self._db.execute(
            "SELECT * FROM drafts WHERE next_attempt_at <= ? ORDER BY created_at ASC",
            (ts,),
        )
        return [self._row(r) for r in cur.fetchall()]

    def list_all(self) -> list[DraftRow]:
        cur = self._db.execute("SELECT * FROM drafts ORDER BY created_at ASC")
        return [self._row(r) for r in cur.fetchall()]

    def mark_attempt(self, draft_id: int, now: int, next_at: int) -> None:
        self._db.execute(
            "UPDATE drafts SET retry_count = retry_count + 1, "
            "last_attempt = ?, next_attempt_at = ? WHERE id = ?",
            (now, next_at, draft_id),
        )
        self._db.commit()

    def remove(self, draft_id: int) -> None:
        self._db.execute("DELETE FROM drafts WHERE id = ?", (draft_id,))
        self._db.commit()

    def close(self) -> None:
        self._db.close()
