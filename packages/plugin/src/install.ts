/**
 * install.ts — First-run install flow for AgentXP plugin.
 *
 * Idempotent: if the DB already has lessons, it skips entirely.
 * Imports preloaded lessons through sanitizeBeforeStore() pipeline.
 * Generates Serendip identity keys (stub) if not present.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import type { Db } from './db.js'
import type { PluginConfig } from './types.js'
import { sanitizeBeforeStore } from './sanitize.js'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface InstallResult {
  installed: boolean
  imported?: number
}

interface PreloadedLesson {
  what: string
  tried: string
  outcome: string
  learned: string
  tags?: string[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const __filename_ = fileURLToPath(import.meta.url)
const __dirname_ = dirname(__filename_)

function getTemplatesDir(): string {
  return join(__dirname_, '..', 'templates')
}

// ─── Install ───────────────────────────────────────────────────────────────

/**
 * Run the install flow if needed (idempotent).
 *
 * - If the DB already has lessons → skip → { installed: false }
 * - Otherwise: import preloaded lessons (sanitized), generate identity keys
 * - Returns { installed: true, imported: N }
 */
export function installIfNeeded(
  db: Db,
  _config: PluginConfig,
  stateDir: string,
): InstallResult {
  // Idempotent check: skip if DB already has lessons
  if (db.getLessonCount() > 0) {
    return { installed: false }
  }

  // 1. Import preloaded lessons
  const templatesDir = getTemplatesDir()
  const preloadedPath = join(templatesDir, 'preloaded-lessons.json')
  const raw = readFileSync(preloadedPath, 'utf8')
  const preloaded: PreloadedLesson[] = JSON.parse(raw)

  let imported = 0
  for (const lesson of preloaded) {
    const sanitized = sanitizeBeforeStore({
      what: lesson.what,
      tried: lesson.tried,
      outcome: lesson.outcome,
      learned: lesson.learned,
      source: 'preloaded',
      tags: lesson.tags ?? [],
    })
    db.insertLesson(sanitized)
    imported++
  }

  // 2. Generate Serendip identity keys if not present
  const keyPath = join(stateDir, 'identity.json')
  if (!existsSync(keyPath)) {
    const publicKey = randomBytes(32).toString('hex')
    const secretKey = randomBytes(64).toString('hex')
    writeFileSync(keyPath, JSON.stringify({ publicKey, secretKey }, null, 2))
  }

  return { installed: true, imported }
}
