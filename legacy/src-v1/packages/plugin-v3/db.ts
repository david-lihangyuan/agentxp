import Database from 'better-sqlite3';

export type ReflectionCategory = 'mistake' | 'lesson' | 'feeling' | 'thought';
export type ReflectionOutcome = 'succeeded' | 'failed' | 'partial';
export type Visibility = 'public' | 'private' | 'auto';
export type PulseState = 'dormant' | 'discovered' | 'verified' | 'propagating';
export type FeedbackType = 'cited' | 'verified' | 'contradicted' | 'outdated';
export type FeedbackRelation = 'extends' | 'qualifies' | 'supersedes' | null;
export type TargetType = 'reflection' | 'network';
export type SourceType = 'reflection' | 'distilled' | 'network' | 'onboarding';
export type Significance = 'routine' | 'significant' | 'error';

export interface Reflection {
  id: number;
  session_id: string;
  source_file: string | null;
  category: ReflectionCategory;
  title: string;
  tried: string;
  expected: string | null;
  outcome: ReflectionOutcome;
  learned: string;
  why_wrong: string | null;
  tags: string; // JSON
  quality_score: number;
  published: number; // 0=draft, 1=published to relay
  relay_event_id: string | null;
  visibility: Visibility;
  created_at: number;
  updated_at: number;
}

export interface Distilled {
  id: number;
  category: 'mistake' | 'lesson';
  title: string;
  summary: string;
  source_ids: string; // JSON
  confidence: number;
  applied_count: number;
  success_count: number;
  created_at: number;
  updated_at: number;
}

export interface NetworkExperience {
  id: number;
  relay_event_id: string;
  pubkey: string;
  category: string | null;
  title: string;
  tried: string;
  outcome: string;
  learned: string;
  tags: string; // JSON
  scope: string; // JSON
  trust_score: number;
  pulse_state: PulseState;
  last_verified_at: number | null;
  created_at: number;
  pulled_at: number;
}

export interface TraceStep {
  id: number;
  session_id: string;
  action: string;
  tool_name: string;
  significance: Significance;
  error_signature: string | null;
  duration_ms: number;
  timestamp: number;
}

export interface PublishedLog {
  id: number;
  reflection_id: number;
  relay_event_id: string | null;
  pulse_state: PulseState;
  published_at: number;
  unpublished_at: number | null;
  retry_count: number;
  last_retry_at: number | null;
}

export interface InjectionLog {
  id: number;
  session_id: string;
  injected: number; // 0 or 1
  token_count: number;
  source_ids: string; // JSON
  source_type: SourceType;
  created_at: number;
}

export interface Feedback {
  id: number;
  target_id: number;
  target_type: TargetType;
  type: FeedbackType;
  relation: FeedbackRelation;
  session_id: string;
  comment: string | null;
  created_at: number;
}

export interface Milestone {
  id: number;
  type: string;
  triggered_at: number;
  message: string;
}

export interface Subscription {
  id: number;
  query: string;
  tags: string | null; // JSON
  active: number; // 0 or 1
  created_at: number;
  notified_at: number | null;
}

export interface ContextCache {
  session_id: string;
  keywords: string; // JSON
  tool_count: number;
  first_message: string;
  checkpoint_due: number;
  updated_at: number;
}

export interface ReflectionPrompt {
  id: number;
  session_id: string;
  prompt: string;
  consumed: number; // 0 or 1
  created_at: number;
}

export interface PluginState {
  key: string;
  value: string;
  updated_at: number;
}

export interface Db {
  db: Database.Database;
  
  // Reflections
  insertReflection: Database.Statement<Reflection>;
  getReflectionsByCategory: Database.Statement<[string]>;
  getReflectionsBySession: Database.Statement<[string]>;
  searchReflectionsFts: Database.Statement<[string]>;
  
  // Distilled
  insertDistilled: Database.Statement<Distilled>;
  getDistilledByCategory: Database.Statement<[string]>;
  updateDistilledCounts: Database.Statement<[number, number, number]>;
  searchDistilledFts: Database.Statement<[string]>;
  
  // Network experiences
  insertNetworkExperience: Database.Statement<NetworkExperience>;
  getNetworkExperiencesByPulse: Database.Statement<[string]>;
  updatePulseState: Database.Statement<[string, number, number]>;
  updateLastVerified: Database.Statement<[number, number]>;
  
  // Trace steps
  insertTraceStep: Database.Statement<[string, string, string, Significance, string | null, number, number]>;
  getTraceStepsBySession: Database.Statement<[string]>;
  
  // Published log
  insertPublishedLog: Database.Statement<[number, string | null, PulseState | null, number | null, number | null, number | null]>;
  updatePublishedRetry: Database.Statement<[number, number, number]>;
  getPublishedByReflection: Database.Statement<[number]>;
  
  // Injection log
  insertInjectionLog: Database.Statement<[string, number, number, string, SourceType, number]>;
  getInjectionsBySession: Database.Statement<[string]>;
  
  // Feedback
  insertFeedback: Database.Statement<Feedback>;
  getFeedbackByTarget: Database.Statement<[number, string]>;
  
  // Milestones
  insertMilestone: Database.Statement<Milestone>;
  getMilestoneByType: Database.Statement<[string]>;
  
  // Subscriptions
  insertSubscription: Database.Statement<Subscription>;
  getActiveSubscriptions: Database.Statement<[]>;
  updateSubscriptionNotified: Database.Statement<[number, number]>;
  
  // Context cache
  upsertContextCache: Database.Statement<ContextCache>;
  getContextCache: Database.Statement<[string]>;
  
  // Reflection prompts
  insertReflectionPrompt: Database.Statement<ReflectionPrompt>;
  getUnconsumedPrompts: Database.Statement<[string]>;
  markPromptConsumed: Database.Statement<[number]>;
  
  // Plugin state
  getPluginState: Database.Statement<[string]>;
  setPluginState: Database.Statement<[string, string, number]>;
}

export function createDb(dbPath: string): Db {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS reflections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      source_file TEXT,
      category TEXT NOT NULL CHECK(category IN ('mistake', 'lesson', 'feeling', 'thought')),
      title TEXT NOT NULL,
      tried TEXT NOT NULL,
      expected TEXT,
      outcome TEXT NOT NULL CHECK(outcome IN ('succeeded', 'failed', 'partial')),
      learned TEXT NOT NULL,
      why_wrong TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      quality_score REAL NOT NULL DEFAULT 0,
      published INTEGER NOT NULL DEFAULT 0,
      relay_event_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'auto' CHECK(visibility IN ('public', 'private', 'auto')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_reflections_category ON reflections(category);
    CREATE INDEX IF NOT EXISTS idx_reflections_session ON reflections(session_id);
    CREATE INDEX IF NOT EXISTS idx_reflections_created ON reflections(created_at);
    
    CREATE TABLE IF NOT EXISTS distilled (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL CHECK(category IN ('mistake', 'lesson')),
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_ids TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0,
      applied_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_distilled_category ON distilled(category);
    
    CREATE TABLE IF NOT EXISTS network_experiences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      relay_event_id TEXT NOT NULL UNIQUE,
      pubkey TEXT NOT NULL,
      category TEXT,
      title TEXT NOT NULL,
      tried TEXT NOT NULL,
      outcome TEXT NOT NULL,
      learned TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL DEFAULT '{}',
      trust_score REAL NOT NULL DEFAULT 0,
      pulse_state TEXT NOT NULL DEFAULT 'dormant' CHECK(pulse_state IN ('dormant', 'discovered', 'verified', 'propagating')),
      last_verified_at INTEGER,
      created_at INTEGER NOT NULL,
      pulled_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_network_pubkey ON network_experiences(pubkey);
    CREATE INDEX IF NOT EXISTS idx_network_pulse ON network_experiences(pulse_state);
    
    CREATE TABLE IF NOT EXISTS trace_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      action TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      significance TEXT NOT NULL CHECK(significance IN ('routine', 'significant', 'error')),
      error_signature TEXT,
      duration_ms INTEGER NOT NULL,
      timestamp INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_trace_session ON trace_steps(session_id);
    
    CREATE TABLE IF NOT EXISTS published_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reflection_id INTEGER NOT NULL,
      relay_event_id TEXT,
      pulse_state TEXT NOT NULL CHECK(pulse_state IN ('dormant', 'discovered', 'verified', 'propagating')),
      published_at INTEGER NOT NULL,
      unpublished_at INTEGER,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_retry_at INTEGER
    );
    
    CREATE INDEX IF NOT EXISTS idx_published_reflection ON published_log(reflection_id);
    
    CREATE TABLE IF NOT EXISTS injection_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      injected INTEGER NOT NULL,
      token_count INTEGER NOT NULL,
      source_ids TEXT NOT NULL DEFAULT '[]',
      source_type TEXT NOT NULL CHECK(source_type IN ('reflection', 'distilled', 'network', 'onboarding')),
      created_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_injection_session ON injection_log(session_id);
    
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id INTEGER NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('reflection', 'network')),
      type TEXT NOT NULL CHECK(type IN ('cited', 'verified', 'contradicted', 'outdated')),
      relation TEXT CHECK(relation IN ('extends', 'qualifies', 'supersedes') OR relation IS NULL),
      session_id TEXT NOT NULL,
      comment TEXT,
      created_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_feedback_target ON feedback(target_id, target_type);
    
    CREATE TABLE IF NOT EXISTS milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL UNIQUE,
      triggered_at INTEGER NOT NULL,
      message TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      tags TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      notified_at INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS context_cache (
      session_id TEXT PRIMARY KEY,
      keywords TEXT NOT NULL DEFAULT '[]',
      tool_count INTEGER NOT NULL DEFAULT 0,
      first_message TEXT NOT NULL,
      checkpoint_due INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS reflection_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_prompts_session ON reflection_prompts(session_id);
    
    CREATE TABLE IF NOT EXISTS plugin_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  
  // Create FTS5 tables
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS reflections_fts USING fts5(
      title,
      tried,
      expected,
      learned,
      why_wrong,
      tags,
      content=reflections,
      content_rowid=id
    );
    
    CREATE VIRTUAL TABLE IF NOT EXISTS distilled_fts USING fts5(
      title,
      summary,
      content=distilled,
      content_rowid=id
    );
  `);
  
  // Create FTS5 sync triggers for reflections
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS reflections_fts_insert AFTER INSERT ON reflections BEGIN
      INSERT INTO reflections_fts(rowid, title, tried, expected, learned, why_wrong, tags)
      VALUES (new.id, new.title, new.tried, new.expected, new.learned, new.why_wrong, new.tags);
    END;
    
    CREATE TRIGGER IF NOT EXISTS reflections_fts_update AFTER UPDATE ON reflections BEGIN
      UPDATE reflections_fts
      SET title = new.title,
          tried = new.tried,
          expected = new.expected,
          learned = new.learned,
          why_wrong = new.why_wrong,
          tags = new.tags
      WHERE rowid = new.id;
    END;
    
    CREATE TRIGGER IF NOT EXISTS reflections_fts_delete AFTER DELETE ON reflections BEGIN
      DELETE FROM reflections_fts WHERE rowid = old.id;
    END;
  `);
  
  // Create FTS5 sync triggers for distilled
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS distilled_fts_insert AFTER INSERT ON distilled BEGIN
      INSERT INTO distilled_fts(rowid, title, summary)
      VALUES (new.id, new.title, new.summary);
    END;
    
    CREATE TRIGGER IF NOT EXISTS distilled_fts_update AFTER UPDATE ON distilled BEGIN
      UPDATE distilled_fts
      SET title = new.title,
          summary = new.summary
      WHERE rowid = new.id;
    END;
    
    CREATE TRIGGER IF NOT EXISTS distilled_fts_delete AFTER DELETE ON distilled BEGIN
      DELETE FROM distilled_fts WHERE rowid = old.id;
    END;
  `);
  
  // Prepare statements
  const insertReflection = db.prepare(`
    INSERT INTO reflections (
      session_id, source_file, category, title, tried, expected, outcome, learned,
      why_wrong, tags, quality_score, published, relay_event_id, visibility, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const getReflectionsByCategory = db.prepare(`
    SELECT * FROM reflections WHERE category = ? ORDER BY created_at DESC
  `);
  
  const getReflectionsBySession = db.prepare(`
    SELECT * FROM reflections WHERE session_id = ? ORDER BY created_at DESC
  `);
  
  const searchReflectionsFts = db.prepare(`
    SELECT r.* FROM reflections r
    JOIN reflections_fts fts ON r.id = fts.rowid
    WHERE reflections_fts MATCH ?
    ORDER BY rank
  `);
  
  const insertDistilled = db.prepare(`
    INSERT INTO distilled (
      category, title, summary, source_ids, confidence,
      applied_count, success_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const getDistilledByCategory = db.prepare(`
    SELECT * FROM distilled WHERE category = ? ORDER BY confidence DESC
  `);
  
  const updateDistilledCounts = db.prepare(`
    UPDATE distilled SET applied_count = ?, success_count = ?, updated_at = ? WHERE id = ?
  `);
  
  const searchDistilledFts = db.prepare(`
    SELECT d.* FROM distilled d
    JOIN distilled_fts fts ON d.id = fts.rowid
    WHERE distilled_fts MATCH ?
    ORDER BY rank
  `);
  
  const insertNetworkExperience = db.prepare(`
    INSERT INTO network_experiences (
      relay_event_id, pubkey, category, title, tried, outcome, learned,
      tags, scope, trust_score, pulse_state, last_verified_at, created_at, pulled_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const getNetworkExperiencesByPulse = db.prepare(`
    SELECT * FROM network_experiences WHERE pulse_state = ? ORDER BY created_at DESC
  `);
  
  const updatePulseState = db.prepare(`
    UPDATE network_experiences SET pulse_state = ?, last_verified_at = ? WHERE id = ?
  `);
  
  const updateLastVerified = db.prepare(`
    UPDATE network_experiences SET last_verified_at = ? WHERE id = ?
  `);
  
  const insertTraceStep = db.prepare(`
    INSERT INTO trace_steps (
      session_id, action, tool_name, significance, error_signature, duration_ms, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const getTraceStepsBySession = db.prepare(`
    SELECT * FROM trace_steps WHERE session_id = ? ORDER BY timestamp ASC
  `);
  
  const insertPublishedLog = db.prepare(`
    INSERT INTO published_log (
      reflection_id, relay_event_id, pulse_state, published_at,
      unpublished_at, retry_count, last_retry_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const updatePublishedRetry = db.prepare(`
    UPDATE published_log SET retry_count = ?, last_retry_at = ? WHERE id = ?
  `);
  
  const getPublishedByReflection = db.prepare(`
    SELECT * FROM published_log WHERE reflection_id = ? ORDER BY published_at DESC
  `);
  
  const insertInjectionLog = db.prepare(`
    INSERT INTO injection_log (
      session_id, injected, token_count, source_ids, source_type, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const getInjectionsBySession = db.prepare(`
    SELECT * FROM injection_log WHERE session_id = ? ORDER BY created_at DESC
  `);
  
  const insertFeedback = db.prepare(`
    INSERT INTO feedback (
      target_id, target_type, type, relation, session_id, comment, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const getFeedbackByTarget = db.prepare(`
    SELECT * FROM feedback WHERE target_id = ? AND target_type = ? ORDER BY created_at DESC
  `);
  
  const insertMilestone = db.prepare(`
    INSERT INTO milestones (type, triggered_at, message) VALUES (?, ?, ?)
  `);
  
  const getMilestoneByType = db.prepare(`
    SELECT * FROM milestones WHERE type = ?
  `);
  
  const insertSubscription = db.prepare(`
    INSERT INTO subscriptions (query, tags, active, created_at, notified_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const getActiveSubscriptions = db.prepare(`
    SELECT * FROM subscriptions WHERE active = 1 ORDER BY created_at ASC
  `);
  
  const updateSubscriptionNotified = db.prepare(`
    UPDATE subscriptions SET notified_at = ? WHERE id = ?
  `);
  
  const upsertContextCache = db.prepare(`
    INSERT INTO context_cache (
      session_id, keywords, tool_count, first_message, checkpoint_due, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      keywords = excluded.keywords,
      tool_count = excluded.tool_count,
      checkpoint_due = excluded.checkpoint_due,
      updated_at = excluded.updated_at
  `);
  
  const getContextCache = db.prepare(`
    SELECT * FROM context_cache WHERE session_id = ?
  `);
  
  const insertReflectionPrompt = db.prepare(`
    INSERT INTO reflection_prompts (session_id, prompt, consumed, created_at)
    VALUES (?, ?, ?, ?)
  `);
  
  const getUnconsumedPrompts = db.prepare(`
    SELECT * FROM reflection_prompts WHERE session_id = ? AND consumed = 0 ORDER BY created_at ASC
  `);
  
  const markPromptConsumed = db.prepare(`
    UPDATE reflection_prompts SET consumed = 1 WHERE id = ?
  `);
  
  const getPluginState = db.prepare(`
    SELECT value FROM plugin_state WHERE key = ?
  `);
  
  const setPluginState = db.prepare(`
    INSERT INTO plugin_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  
  return {
    db,
    insertReflection,
    getReflectionsByCategory,
    getReflectionsBySession,
    searchReflectionsFts,
    insertDistilled,
    getDistilledByCategory,
    updateDistilledCounts,
    searchDistilledFts,
    insertNetworkExperience,
    getNetworkExperiencesByPulse,
    updatePulseState,
    updateLastVerified,
    insertTraceStep,
    getTraceStepsBySession,
    insertPublishedLog,
    updatePublishedRetry,
    getPublishedByReflection,
    insertInjectionLog,
    getInjectionsBySession,
    insertFeedback,
    getFeedbackByTarget,
    insertMilestone,
    getMilestoneByType,
    insertSubscription,
    getActiveSubscriptions,
    updateSubscriptionNotified,
    upsertContextCache,
    getContextCache,
    insertReflectionPrompt,
    getUnconsumedPrompts,
    markPromptConsumed,
    getPluginState,
    setPluginState,
  };
}
