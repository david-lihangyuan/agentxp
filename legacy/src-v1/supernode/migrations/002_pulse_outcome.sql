-- Migration 002: Add outcome column to pulse_events
-- Stores the task outcome when a resolved_hit is recorded.

ALTER TABLE pulse_events ADD COLUMN outcome TEXT;
