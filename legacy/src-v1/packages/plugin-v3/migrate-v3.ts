/**
 * Migration script for AgentXP Plugin v3
 * 
 * Adds new fields to existing reflections table:
 * - source_file
 * - published (replaces publishable)
 * - relay_event_id
 * - updated_at
 * 
 * Makes expected nullable (was required before)
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync } from 'fs';

function migrateDb(dbPath: string): void {
  console.log(`Migrating database: ${dbPath}`);
  
  if (!existsSync(dbPath)) {
    console.log('Database does not exist yet, no migration needed.');
    return;
  }
  
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  try {
    // Check if migration is needed
    const tableInfo = db.prepare("PRAGMA table_info(reflections)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    
    const hasSourceFile = tableInfo.some(col => col.name === 'source_file');
    const hasPublished = tableInfo.some(col => col.name === 'published');
    const hasRelayEventId = tableInfo.some(col => col.name === 'relay_event_id');
    const hasUpdatedAt = tableInfo.some(col => col.name === 'updated_at');
    
    if (hasSourceFile && hasPublished && hasRelayEventId && hasUpdatedAt) {
      console.log('✓ Database already migrated to v3 schema');
      db.close();
      return;
    }
    
    console.log('Starting migration...');
    
    // Create new table with v3 schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS reflections_v3 (
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
    `);
    
    // Migrate data from old table
    // publishable -> published (0/1 mapping is the same)
    // Add updated_at = created_at for old records
    const hasPublishable = tableInfo.some(col => col.name === 'publishable');
    
    if (hasPublishable) {
      db.exec(`
        INSERT INTO reflections_v3 (
          id, session_id, source_file, category, title, tried, expected,
          outcome, learned, why_wrong, tags, quality_score, published,
          relay_event_id, visibility, created_at, updated_at
        )
        SELECT 
          id, session_id, NULL, category, title, tried, expected,
          outcome, learned, why_wrong, tags, quality_score, publishable,
          NULL, visibility, created_at, created_at
        FROM reflections;
      `);
      
      console.log('✓ Migrated existing reflections');
    }
    
    // Drop old table and rename new one
    db.exec(`
      DROP TABLE IF EXISTS reflections;
      ALTER TABLE reflections_v3 RENAME TO reflections;
    `);
    
    // Recreate indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_reflections_category ON reflections(category);
      CREATE INDEX IF NOT EXISTS idx_reflections_session ON reflections(session_id);
      CREATE INDEX IF NOT EXISTS idx_reflections_created ON reflections(created_at);
    `);
    
    // Drop and recreate FTS table to sync with new schema
    db.exec(`
      DROP TABLE IF EXISTS reflections_fts;
      CREATE VIRTUAL TABLE reflections_fts USING fts5(
        title,
        tried,
        expected,
        learned,
        why_wrong,
        tags,
        content=reflections,
        content_rowid=id
      );
    `);
    
    // Populate FTS from new table
    db.exec(`
      INSERT INTO reflections_fts(rowid, title, tried, expected, learned, why_wrong, tags)
      SELECT id, title, tried, expected, learned, why_wrong, tags
      FROM reflections;
    `);
    
    // Recreate FTS triggers
    db.exec(`
      DROP TRIGGER IF EXISTS reflections_fts_insert;
      DROP TRIGGER IF EXISTS reflections_fts_update;
      DROP TRIGGER IF EXISTS reflections_fts_delete;
      
      CREATE TRIGGER reflections_fts_insert AFTER INSERT ON reflections BEGIN
        INSERT INTO reflections_fts(rowid, title, tried, expected, learned, why_wrong, tags)
        VALUES (new.id, new.title, new.tried, new.expected, new.learned, new.why_wrong, new.tags);
      END;
      
      CREATE TRIGGER reflections_fts_update AFTER UPDATE ON reflections BEGIN
        UPDATE reflections_fts
        SET title = new.title,
            tried = new.tried,
            expected = new.expected,
            learned = new.learned,
            why_wrong = new.why_wrong,
            tags = new.tags
        WHERE rowid = new.id;
      END;
      
      CREATE TRIGGER reflections_fts_delete AFTER DELETE ON reflections BEGIN
        DELETE FROM reflections_fts WHERE rowid = old.id;
      END;
    `);
    
    console.log('✓ Migration completed successfully');
    
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  } finally {
    db.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const workspaceDir = process.env.WORKSPACE_DIR || join(process.cwd(), '../../..');
  const dbPath = join(workspaceDir, '.agentxp', 'plugin-v3.db');
  
  migrateDb(dbPath);
}

export { migrateDb };
