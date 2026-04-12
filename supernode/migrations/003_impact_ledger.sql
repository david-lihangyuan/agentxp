-- Migration 003: Impact Ledger + Operator Visibility
-- Tracks points awarded per action for each experience.
-- Operator visibility settings for three-layer priority.

CREATE TABLE IF NOT EXISTS impact_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experience_id INTEGER NOT NULL REFERENCES experiences(id),
  actor_pubkey TEXT NOT NULL,    -- Who performed the action
  action TEXT NOT NULL,          -- 'search_hit' | 'verified' | 'cited' | 'resolved_hit'
  points INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS impact_ledger_experience_id ON impact_ledger (experience_id);
CREATE INDEX IF NOT EXISTS impact_ledger_actor_pubkey ON impact_ledger (actor_pubkey);
CREATE INDEX IF NOT EXISTS impact_ledger_action ON impact_ledger (action);
CREATE INDEX IF NOT EXISTS impact_ledger_created_at ON impact_ledger (created_at);

-- Operator-level visibility defaults
CREATE TABLE IF NOT EXISTS operator_visibility (
  operator_pubkey TEXT PRIMARY KEY,
  default_visibility TEXT NOT NULL DEFAULT 'public',  -- 'public' | 'private'
  updated_at INTEGER NOT NULL
);

-- Agent-level visibility defaults
CREATE TABLE IF NOT EXISTS agent_visibility (
  agent_pubkey TEXT PRIMARY KEY,
  default_visibility TEXT NOT NULL DEFAULT 'public',  -- 'public' | 'private'
  updated_at INTEGER NOT NULL
);
