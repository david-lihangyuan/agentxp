-- Migration 007: Reasoning Trace (L2 upgrade)
-- Adds trace columns to experiences and creates supporting tables.

-- Give experiences table a reasoning_trace column (JSON text)
ALTER TABLE experiences ADD COLUMN reasoning_trace TEXT;

-- Indexable scalar fields extracted from the trace (#27)
ALTER TABLE experiences ADD COLUMN question_id TEXT;
ALTER TABLE experiences ADD COLUMN parent_trace_id TEXT;
ALTER TABLE experiences ADD COLUMN trace_worthiness TEXT DEFAULT 'low';
ALTER TABLE experiences ADD COLUMN domain_ecosystem TEXT;
ALTER TABLE experiences ADD COLUMN domain_layer TEXT;
ALTER TABLE experiences ADD COLUMN reproducibility TEXT;
ALTER TABLE experiences ADD COLUMN deprecated_at INTEGER;
ALTER TABLE experiences ADD COLUMN deprecated_by TEXT;

-- Indexes for fast filtering (#27)
CREATE INDEX IF NOT EXISTS idx_exp_question_id ON experiences(question_id);
CREATE INDEX IF NOT EXISTS idx_exp_parent_trace ON experiences(parent_trace_id);
CREATE INDEX IF NOT EXISTS idx_exp_domain ON experiences(domain_ecosystem, domain_layer);
CREATE INDEX IF NOT EXISTS idx_exp_worthiness ON experiences(trace_worthiness);
CREATE INDEX IF NOT EXISTS idx_exp_deprecated ON experiences(deprecated_at);

-- Trace feedback table (#17)
CREATE TABLE IF NOT EXISTS trace_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  experience_id INTEGER REFERENCES experiences(id),
  consumer_pubkey TEXT NOT NULL,
  applied BOOLEAN NOT NULL DEFAULT 0,
  outcome TEXT CHECK(outcome IN ('success', 'partial', 'failed')),
  notes TEXT,
  transferability_perceived REAL,
  created_at INTEGER NOT NULL,
  UNIQUE(trace_id, consumer_pubkey)
);

CREATE INDEX IF NOT EXISTS idx_feedback_trace ON trace_feedback(trace_id);
CREATE INDEX IF NOT EXISTS idx_feedback_consumer ON trace_feedback(consumer_pubkey);

-- Experience reference relation table (#25)
CREATE TABLE IF NOT EXISTS trace_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_experience_id INTEGER NOT NULL REFERENCES experiences(id),
  referenced_experience_id INTEGER NOT NULL REFERENCES experiences(id),
  step_index INTEGER,
  stale BOOLEAN NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ref_source ON trace_references(source_experience_id);
CREATE INDEX IF NOT EXISTS idx_ref_referenced ON trace_references(referenced_experience_id);
CREATE INDEX IF NOT EXISTS idx_ref_stale ON trace_references(stale);
