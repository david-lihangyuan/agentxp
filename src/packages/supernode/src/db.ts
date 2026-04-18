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
`
