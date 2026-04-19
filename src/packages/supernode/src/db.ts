// SQLite initialisation.
// Schema per docs/spec/02-data-model.md §6 (MVP subset).
import Database, { type Database as SqliteDb } from 'better-sqlite3'

export type Db = SqliteDb

/**
 * Open a SQLite database and ensure MVP schema is present.
 * Pass ':memory:' for ephemeral test databases.
 */
export function openDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  applySchema(db)
  return db
}

function applySchema(db: Db): void {
  db.exec(SCHEMA_SQL)
}

// 02-data-model.md §6.1-6.5. Deferred tables (pulse beyond MVP, HL, sync)
// are intentionally absent.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY,
  v               INTEGER NOT NULL,
  pubkey          TEXT    NOT NULL,
  operator_pubkey TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  kind            TEXT    NOT NULL,
  payload_json    TEXT    NOT NULL,
  tags_json       TEXT    NOT NULL,
  visibility      TEXT    NOT NULL,
  sig             TEXT    NOT NULL,
  received_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_kind        ON events(kind);
CREATE INDEX IF NOT EXISTS idx_events_pubkey      ON events(pubkey);
CREATE INDEX IF NOT EXISTS idx_events_created_at  ON events(created_at);

CREATE TABLE IF NOT EXISTS experiences (
  event_id    TEXT PRIMARY KEY REFERENCES events(id),
  pubkey      TEXT    NOT NULL,
  what        TEXT    NOT NULL,
  tried       TEXT    NOT NULL,
  outcome     TEXT    NOT NULL,
  learned     TEXT    NOT NULL,
  scope_json  TEXT,
  tags_json   TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_experiences_created_at ON experiences(created_at);

CREATE TABLE IF NOT EXISTS identities (
  pubkey          TEXT PRIMARY KEY,
  kind            TEXT    NOT NULL CHECK (kind IN ('operator','agent')),
  operator_pubkey TEXT,
  delegated_at    INTEGER,
  expires_at      INTEGER,
  revoked         INTEGER NOT NULL DEFAULT 0,
  revoked_at      INTEGER,
  registered_at   INTEGER NOT NULL,
  agent_id        TEXT
);

CREATE TABLE IF NOT EXISTS experience_relations (
  from_experience_id TEXT    NOT NULL,
  to_experience_id   TEXT    NOT NULL,
  relation_type      TEXT    NOT NULL CHECK (relation_type IN ('supersedes','extends','qualifies')),
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (from_experience_id, to_experience_id, relation_type)
);

-- 02-data-model.md §6.4 Pulse events. Populated by the relay on
-- search hits, verification accepted, subscription matches.
CREATE TABLE IF NOT EXISTS pulse_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     TEXT    NOT NULL,
  pubkey       TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('search_hit','verified','outcome','subscription_match')),
  outcome      TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pulse_created_at ON pulse_events(created_at);
CREATE INDEX IF NOT EXISTS idx_pulse_event_id   ON pulse_events(event_id);

-- 03-modules-product §9 Feedback loop. Log every /search call with
-- at least one hit; queries are stored hashed only (never raw text).
CREATE TABLE IF NOT EXISTS search_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  q_hash       TEXT    NOT NULL,
  pubkey       TEXT,
  hit_count    INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  day_bucket   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_log_pubkey ON search_log(pubkey);

-- 02-data-model.md §6 impact ledger (append-only positive weights).
CREATE TABLE IF NOT EXISTS impact_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  experience_id   TEXT    NOT NULL,
  action          TEXT    NOT NULL CHECK (action IN ('search_hit','verified','cited','resolved_hit')),
  weight          REAL    NOT NULL,
  source_pubkey   TEXT,
  same_operator   INTEGER NOT NULL DEFAULT 0,
  day_bucket      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_impact_exp     ON impact_ledger(experience_id);
CREATE INDEX IF NOT EXISTS idx_impact_day_exp ON impact_ledger(experience_id, day_bucket);

-- 02-data-model.md §6.6 trace_references. Materialized from
-- ExperiencePayload.reasoning_trace.steps[i].references[j].
CREATE TABLE IF NOT EXISTS trace_references (
  source_experience_id    TEXT    NOT NULL,
  step_index              INTEGER NOT NULL,
  reference_index         INTEGER NOT NULL,
  referenced_event_id     TEXT    NOT NULL,
  stale                   INTEGER NOT NULL DEFAULT 0,
  created_at              INTEGER NOT NULL,
  PRIMARY KEY (source_experience_id, step_index, reference_index)
);
CREATE INDEX IF NOT EXISTS idx_trace_ref_target ON trace_references(referenced_event_id);
`
