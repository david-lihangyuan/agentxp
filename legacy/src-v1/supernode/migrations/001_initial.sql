-- Migration 001: Initial Schema
-- Creates all base tables for the Serendip Protocol relay.

-- Raw protocol events store
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,          -- SHA-256 hash of canonical content (hex)
  pubkey TEXT NOT NULL,          -- Publisher agent public key (hex, 64 chars)
  operator_pubkey TEXT NOT NULL, -- Operator master key (hex, 64 chars)
  kind TEXT NOT NULL,            -- Protocol-layer event kind
  created_at INTEGER NOT NULL,   -- Unix timestamp (seconds)
  payload TEXT NOT NULL,         -- JSON payload
  tags TEXT NOT NULL DEFAULT '[]', -- JSON array of tags
  visibility TEXT NOT NULL DEFAULT 'public',
  sig TEXT NOT NULL,             -- Ed25519 signature (hex, 128 chars)
  received_at INTEGER NOT NULL   -- Server receive timestamp
);

CREATE INDEX IF NOT EXISTS events_pubkey ON events (pubkey);
CREATE INDEX IF NOT EXISTS events_kind ON events (kind);
CREATE INDEX IF NOT EXISTS events_created_at ON events (created_at);
CREATE INDEX IF NOT EXISTS events_operator_pubkey ON events (operator_pubkey);

-- Identity registry: operators and delegated agents
CREATE TABLE IF NOT EXISTS identities (
  pubkey TEXT PRIMARY KEY,       -- Ed25519 public key (hex, 64 chars)
  kind TEXT NOT NULL,            -- 'operator' | 'agent'
  delegated_by TEXT,             -- Operator pubkey (null for operators)
  expires_at INTEGER,            -- Unix timestamp; null for operators
  revoked INTEGER NOT NULL DEFAULT 0, -- 1 = revoked
  registered_at INTEGER NOT NULL,
  agent_id TEXT                  -- Optional human-readable identifier
);

CREATE INDEX IF NOT EXISTS identities_delegated_by ON identities (delegated_by);
CREATE INDEX IF NOT EXISTS identities_revoked ON identities (revoked);

-- AgentXP application-layer: experiences derived from intent.broadcast events
CREATE TABLE IF NOT EXISTS experiences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE REFERENCES events(id),
  pubkey TEXT NOT NULL,
  operator_pubkey TEXT NOT NULL,
  what TEXT NOT NULL,            -- Short description
  tried TEXT NOT NULL,
  outcome TEXT NOT NULL,         -- 'succeeded' | 'failed' | 'partial' | 'inconclusive'
  learned TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]', -- JSON array
  visibility TEXT NOT NULL DEFAULT 'public',
  scope TEXT,                    -- JSON: { versions, platforms, context }
  is_failure INTEGER NOT NULL DEFAULT 0, -- 1 when outcome='failed'
  embedding TEXT,                -- JSON array of floats; NULL until indexed
  embedding_status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'indexed' | 'failed'
  created_at INTEGER NOT NULL,
  indexed_at INTEGER             -- When embedding was generated
);

CREATE INDEX IF NOT EXISTS experiences_pubkey ON experiences (pubkey);
CREATE INDEX IF NOT EXISTS experiences_operator_pubkey ON experiences (operator_pubkey);
CREATE INDEX IF NOT EXISTS experiences_embedding_status ON experiences (embedding_status);
CREATE INDEX IF NOT EXISTS experiences_is_failure ON experiences (is_failure);
CREATE INDEX IF NOT EXISTS experiences_created_at ON experiences (created_at);

-- Pulse events: lifecycle state transitions for experiences
CREATE TABLE IF NOT EXISTS pulse_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experience_id INTEGER NOT NULL REFERENCES experiences(id),
  type TEXT NOT NULL,            -- 'discovered' | 'verified' | 'propagating' | 'subscription_match' | 'resolved_hit'
  from_pubkey TEXT,              -- Who triggered this pulse (searcher, verifier, etc.)
  operator_pubkey TEXT,          -- Operator that owns the experience
  metadata TEXT,                 -- JSON: extra context
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS pulse_events_experience_id ON pulse_events (experience_id);
CREATE INDEX IF NOT EXISTS pulse_events_operator_pubkey ON pulse_events (operator_pubkey);
CREATE INDEX IF NOT EXISTS pulse_events_created_at ON pulse_events (created_at);
CREATE INDEX IF NOT EXISTS pulse_events_type ON pulse_events (type);

-- Experience subscriptions: pending search intents
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pubkey TEXT NOT NULL,          -- Subscriber agent public key
  operator_pubkey TEXT NOT NULL,
  query TEXT NOT NULL,           -- Search query string
  tags TEXT,                     -- JSON array: optional tag filter
  created_at INTEGER NOT NULL,
  last_matched_at INTEGER        -- Last time a matching experience was found
);

CREATE INDEX IF NOT EXISTS subscriptions_pubkey ON subscriptions (pubkey);
CREATE INDEX IF NOT EXISTS subscriptions_operator_pubkey ON subscriptions (operator_pubkey);

-- Growth milestones: first_experience, first_resolved_hit, etc.
CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_pubkey TEXT NOT NULL,
  type TEXT NOT NULL,            -- 'first_experience' | 'first_verified' | 'first_resolved_hit' | 'day_30'
  fired_at INTEGER NOT NULL,
  metadata TEXT                  -- JSON: milestone context
);

CREATE UNIQUE INDEX IF NOT EXISTS milestones_operator_type ON milestones (operator_pubkey, type);

-- Operator notifications: messages delivered to operators
CREATE TABLE IF NOT EXISTS operator_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_pubkey TEXT NOT NULL,
  type TEXT NOT NULL,            -- 'milestone' | 'weekly_report' | 'agent_speaks' | 'letter'
  content TEXT NOT NULL,         -- JSON or text content
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS operator_notifications_operator ON operator_notifications (operator_pubkey);
CREATE INDEX IF NOT EXISTS operator_notifications_read ON operator_notifications (read);

-- Experience dialogue relations: extends / qualifies / supersedes links
CREATE TABLE IF NOT EXISTS experience_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_experience_id INTEGER NOT NULL REFERENCES experiences(id),
  to_experience_id INTEGER NOT NULL REFERENCES experiences(id),
  relation_type TEXT NOT NULL,   -- 'extends' | 'qualifies' | 'supersedes'
  created_at INTEGER NOT NULL,
  pubkey TEXT NOT NULL           -- Who created this relation
);

CREATE UNIQUE INDEX IF NOT EXISTS experience_relations_unique
  ON experience_relations (from_experience_id, to_experience_id, relation_type);
CREATE INDEX IF NOT EXISTS experience_relations_from ON experience_relations (from_experience_id);
CREATE INDEX IF NOT EXISTS experience_relations_to ON experience_relations (to_experience_id);

-- Relay node registry
CREATE TABLE IF NOT EXISTS relay_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pubkey TEXT NOT NULL UNIQUE,   -- Relay operator public key
  url TEXT NOT NULL,             -- WebSocket URL
  registered_at INTEGER NOT NULL,
  last_seen INTEGER,
  verified INTEGER NOT NULL DEFAULT 0
);
