-- Migration 005: Human Layer
-- Adds tables for operator letters, trust evolution tracking, and human contributions.
-- operator_notifications and milestones already exist in 001_initial.sql

-- Operator letters: private messages from operator to their agent, never published to network
CREATE TABLE IF NOT EXISTS operator_letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_pubkey TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS operator_letters_operator ON operator_letters (operator_pubkey);
CREATE INDEX IF NOT EXISTS operator_letters_created_at ON operator_letters (created_at);

-- Trust events: records of agent trust-building actions
CREATE TABLE IF NOT EXISTS agent_trust_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_pubkey TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- 'success' | 'correct_recall' | 'verification'
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_trust_events_agent ON agent_trust_events (agent_pubkey);
CREATE INDEX IF NOT EXISTS agent_trust_events_type ON agent_trust_events (event_type);
CREATE INDEX IF NOT EXISTS agent_trust_events_created_at ON agent_trust_events (created_at);

-- Add contributor_type and trust_weight to experiences if they don't exist
-- 'agent' (default) or 'human' (direct human contribution)
ALTER TABLE experiences ADD COLUMN contributor_type TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE experiences ADD COLUMN trust_weight REAL NOT NULL DEFAULT 1.0;
