// Supernode — Database Connection & Migration Runner
import { Database } from 'bun:sqlite'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from './logger'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Path to migrations directory (relative to this file)
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations')

/**
 * Run all pending SQL migrations from the migrations/ directory.
 * Migrations are executed in alphabetical (numeric) order.
 * Each migration file is tracked in the _migrations table.
 * Running twice is idempotent — already-applied migrations are skipped.
 */
export function runMigrations(db: Database): void {
  // Ensure migration tracking table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)

  // Get list of already-applied migrations
  const applied = new Set(
    (db.query('SELECT name FROM _migrations').all() as Array<{ name: string }>).map(
      (r) => r.name
    )
  )

  // Read and sort migration files synchronously using Bun's sync APIs
  let migrationFiles: string[] = []
  try {
    // Use Bun's synchronous file system if available
    const { readdirSync } = require('node:fs')
    const entries = readdirSync(MIGRATIONS_DIR) as string[]
    migrationFiles = entries
      .filter((f: string) => f.endsWith('.sql'))
      .sort()
  } catch {
    // Directory doesn't exist yet — no migrations to run
    return
  }

  for (const file of migrationFiles) {
    if (applied.has(file)) continue

    try {
      const { readFileSync } = require('node:fs')
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8') as string

      // Execute the migration inside a transaction
      db.transaction(() => {
        // Parse SQL correctly — order matters:
        // 1. Strip -- line comments first (so semicolons in comments don't split statements)
        // 2. Remove /* */ block comments
        // 3. Split by semicolons to get individual statements
        //
        // The original bug: splitting by ';' before stripping '--' comments caused
        // "-- comment text; more comment" to split into spurious statements.

        // Step 1: Strip -- line comments (each line, strip from -- to end of line)
        let stripped = sql
          .split('\n')
          .map((line) => {
            const commentIdx = line.indexOf('--')
            return commentIdx >= 0 ? line.slice(0, commentIdx) : line
          })
          .join('\n')

        // Step 2: Remove /* */ block comments (non-greedy, handles multi-line)
        stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, ' ')

        // Step 3: Split by semicolons and execute each non-empty statement
        const statements = stripped
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)

        for (const stmt of statements) {
          db.run(stmt)
        }

        db.run('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)', [
          file,
          Math.floor(Date.now() / 1000),
        ])
      })()

      logger.info('Migration applied', { migration: file })
    } catch (err) {
      logger.error('Migration failed', {
        migration: file,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }
}

/** Open (or create) a SQLite database and run all pending migrations. */
export function openDatabase(dbPath: string): Database {
  const db = new Database(dbPath, { create: true })

  // Enable WAL mode for better concurrent read performance
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  db.run('PRAGMA busy_timeout = 5000')

  runMigrations(db)
  return db
}

/** Singleton DB instance for production use */
let _db: Database | null = null

export function getDb(dbPath?: string): Database {
  if (!_db) {
    _db = openDatabase(dbPath ?? process.env['DATABASE_PATH'] ?? './data/supernode.db')
  }
  return _db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
