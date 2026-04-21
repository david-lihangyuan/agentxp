// MVP-DONE driver: Plugin v3 publishes one experience whose
// reasoning_trace has a step referencing a Skill-published event id.
//
// Exercises @agentxp/openclaw-plugin primitives (onToolCall + onSessionEnd +
// publishStagedExperiences) in the same process, using the identity
// material already produced by the Skill flow. Cross-reference is
// injected by rewriting the staged trace_json with
// `references: [$SKILL_EVENT_ID]` on the last step before publishing,
// so the relay materialises a `trace_references` row per §12.
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { hexToBytes } from '@agentxp/protocol'
import {
  openPluginDb,
  onToolCall,
  onSessionEnd,
  publishStagedExperiences,
} from '@agentxp/openclaw-plugin'

const root = process.env['ROOT']
const relay = process.env['RELAY_URL']
const skillEvent = process.env['SKILL_EVENT_ID']
if (!root || !relay || !skillEvent) {
  throw new Error('ROOT, RELAY_URL, SKILL_EVENT_ID env vars required')
}

const identityDir = root + '/home/.agentxp/identity'
const agentDisk = JSON.parse(readFileSync(identityDir + '/agent.json', 'utf8'))
const agent = {
  publicKey: agentDisk.publicKey,
  privateKey: hexToBytes(agentDisk.privateKey),
  delegatedBy: agentDisk.delegatedBy,
  expiresAt: agentDisk.expiresAt,
  agentId: agentDisk.agentId,
}

const sessionId = 'mvp-done-plugin-session'
const db = openPluginDb(root + '/workspace/.agentxp/plugin.sqlite')

// Three synthetic tool_call hooks + one session_end — matches M4 check 1.
for (let i = 0; i < 3; i++) {
  onToolCall(db, {
    session_id: sessionId,
    created_at: new Date(Date.UTC(2026, 3, 18, 0, i)).toISOString(),
    tool_call: {
      name: i === 1 ? 'read_file' : 'bash',
      arguments: { cmd: `echo mvp-done-step-${i}` },
      result: `stdout-${i}`,
      duration_ms: 200 + i,
    },
  })
}

onSessionEnd(
  db,
  {
    session_id: sessionId,
    ended_at: new Date(Date.UTC(2026, 3, 18, 0, 5)).toISOString(),
    reason: 'explicit',
  },
  {
    what: 'MVP-DONE end-to-end cross-SKU experience',
    tried: 'Plugin v3 publishes an experience that cites the Skill event',
    outcome: 'succeeded',
    learned: 'Relay materialises trace_references across SKUs',
    tags: ['mvp-done', 'plugin-v3'],
    context_at_start: 'mvp-done-smoke',
  },
)

// Inject cross-reference into the staged trace_json: last step gets
// references=[$SKILL_EVENT_ID]. This is the bit the relay picks up
// and writes as a trace_references row in indexTraceReferences().
const raw = new Database(root + '/workspace/.agentxp/plugin.sqlite')
const row = raw
  .prepare('SELECT id, trace_json FROM staged_experiences WHERE session_id = ?')
  .get(sessionId)
if (!row) throw new Error('no staged experience to patch')
const trace = JSON.parse(row.trace_json)
const lastIdx = trace.steps.length - 1
trace.steps[lastIdx].references = [skillEvent]
raw.prepare('UPDATE staged_experiences SET trace_json = ? WHERE id = ?')
  .run(JSON.stringify(trace), row.id)
raw.close()

const results = await publishStagedExperiences({
  relayUrl: relay,
  agent,
  db,
})
db.close()

const published = results.find((r) => r.status === 'published')
if (!published) {
  console.error(JSON.stringify(results))
  throw new Error('plugin v3 publish did not succeed')
}
console.log(`plugin_event_id=${published.eventId}`)
