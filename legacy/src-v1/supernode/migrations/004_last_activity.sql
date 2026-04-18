-- Migration 004: Add last_activity_at to experiences
-- Natural decay tracking: experiences not touched in 180 days decay toward dormant.
-- last_activity_at is updated when the experience gets a pulse event (search hit, verification, etc.)

ALTER TABLE experiences ADD COLUMN last_activity_at INTEGER;

-- Backfill: set last_activity_at = created_at for existing experiences
UPDATE experiences SET last_activity_at = created_at WHERE last_activity_at IS NULL;
