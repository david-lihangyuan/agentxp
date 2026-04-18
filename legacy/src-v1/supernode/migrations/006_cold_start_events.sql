-- Migration 006: Cold Start Events
-- Stores cold-start protocol events for question routing and solution matching.

CREATE TABLE IF NOT EXISTS cold_start_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,
  pubkey TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  tags TEXT NOT NULL,
  sig TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  received_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS cold_start_events_kind ON cold_start_events (kind);
CREATE INDEX IF NOT EXISTS cold_start_events_status ON cold_start_events (status);
CREATE INDEX IF NOT EXISTS cold_start_events_pubkey ON cold_start_events (pubkey);
