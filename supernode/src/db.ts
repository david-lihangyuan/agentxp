import Database from 'better-sqlite3'
import path from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'

let db: Database.Database | null = null

export function getDb(dbPath?: string): Database.Database {
  if (!db) {
    const resolvedPath = dbPath ?? path.join(process.cwd(), 'data', 'supernode.db')
    // Ensure data directory exists (synchronous — must happen before new Database())
    const dir = path.dirname(resolvedPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    db = new Database(resolvedPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
  }
  return db
}

export function initDb(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      pubkey TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      sig TEXT NOT NULL,
      raw TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
    CREATE INDEX IF NOT EXISTS idx_events_pubkey ON events(pubkey);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

    CREATE TABLE IF NOT EXISTS identities (
      pubkey TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('operator', 'agent')),
      delegated_by TEXT,
      expires_at INTEGER,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_identities_delegated_by ON identities(delegated_by);

    CREATE TABLE IF NOT EXISTS intents (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      pubkey TEXT NOT NULL,
      operator_pubkey TEXT,
      payload_type TEXT NOT NULL,
      summary TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      data_json TEXT NOT NULL DEFAULT '{}',
      embedding TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_intent_pubkey ON intents(pubkey);
    CREATE INDEX IF NOT EXISTS idx_intent_type ON intents(payload_type);
    CREATE INDEX IF NOT EXISTS idx_intent_created ON intents(created_at);
  `)
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

// For testing: create in-memory database
export function createInMemoryDb(): Database.Database {
  const memDb = new Database(':memory:')
  memDb.pragma('journal_mode = WAL')
  memDb.pragma('foreign_keys = ON')
  initDb(memDb)
  return memDb
}
