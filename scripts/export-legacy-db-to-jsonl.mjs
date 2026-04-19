// Export a legacy (src-v1) supernode.db to JSONL archives before the
// MVP v0.1 clean-slate cutover (MVP-DONE strategy A).
//
// Dumps three tables: events (source of truth), identities, and
// experience_relations. Derived views (experiences, pulse_events,
// impact_ledger, trace_references, ...) are intentionally skipped —
// they can be rematerialised from events if we ever need to replay.
//
// Usage:
//   node scripts/export-legacy-db-to-jsonl.mjs \
//     --db /path/to/legacy-supernode.db \
//     --out /path/to/archive-dir/
//
// Safety: opens the DB in readonly mode; never mutates the source
// file. Safe to run against a live production DB snapshot.
import Database from 'better-sqlite3'
import { mkdirSync, createWriteStream, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--db') out.db = argv[++i]
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--help' || a === '-h') out.help = true
    else throw new Error(`unknown argument: ${a}`)
  }
  return out
}

function usage() {
  console.log('Usage: export-legacy-db-to-jsonl.mjs --db <path> --out <dir>')
  console.log('  --db   Path to legacy supernode.db (read-only)')
  console.log('  --out  Directory to write JSONL archives into')
}

const args = parseArgs(process.argv.slice(2))
if (args.help || !args.db || !args.out) {
  usage()
  process.exit(args.help ? 0 : 1)
}

const dbPath = resolve(args.db)
const outDir = resolve(args.out)
if (!existsSync(dbPath)) {
  console.error(`error: db not found: ${dbPath}`)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const db = new Database(dbPath, { readonly: true, fileMustExist: true })

function dump(table, query, outFile) {
  const stream = createWriteStream(outFile, { encoding: 'utf8' })
  const stmt = db.prepare(query)
  let count = 0
  for (const row of stmt.iterate()) {
    stream.write(JSON.stringify(row) + '\n')
    count++
  }
  stream.end()
  return count
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const results = []

// events: the only authoritative table. Everything else is derived.
// Export every column so the archive is lossless.
results.push([
  'events',
  dump(
    'events',
    `SELECT id, pubkey, operator_pubkey, kind, created_at,
            payload, tags, visibility, sig, received_at
       FROM events ORDER BY created_at ASC, id ASC`,
    `${outDir}/events-${timestamp}.jsonl`,
  ),
])

// identities: operator + agent registry. Could be reconstructed from
// identity.register / identity.delegate events, but dumping it
// directly is a cheap sanity check on the cutover.
results.push([
  'identities',
  dump(
    'identities',
    `SELECT pubkey, kind, delegated_by, expires_at, revoked,
            registered_at, agent_id
       FROM identities ORDER BY registered_at ASC, pubkey ASC`,
    `${outDir}/identities-${timestamp}.jsonl`,
  ),
])

// experience_relations: human-authored extends/qualifies/supersedes.
// These do NOT come from protocol events in v1, so they MUST be
// archived — there's no other way to rebuild them.
results.push([
  'experience_relations',
  dump(
    'experience_relations',
    `SELECT from_experience_id, to_experience_id, relation_type,
            created_at, pubkey
       FROM experience_relations ORDER BY created_at ASC, id ASC`,
    `${outDir}/experience-relations-${timestamp}.jsonl`,
  ),
])

// Integrity summary so the archive is trivially auditable.
const summary = {
  source_db: dbPath,
  archive_dir: outDir,
  archived_at: new Date().toISOString(),
  archive_tag: `legacy-v1-archive-${timestamp}`,
  tables: Object.fromEntries(results),
  total_rows: results.reduce((a, [, n]) => a + n, 0),
}
const summaryFile = `${outDir}/SUMMARY-${timestamp}.json`
createWriteStream(summaryFile).end(JSON.stringify(summary, null, 2) + '\n')

db.close()

console.log(JSON.stringify(summary, null, 2))
console.log(`\nwrote ${results.length + 1} files to ${outDir}`)
