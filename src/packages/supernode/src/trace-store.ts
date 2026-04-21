// trace_references materialisation and trace structural validation.
// SPEC 02-data-model §4 + §6.6 + §8(I4); 03-modules-product §12.
//
// The protocol layer treats reasoning_trace as `unknown`; the relay
// enforces the structure so that §12 acceptance 3 (reject
// non-array steps with 400 invalid_trace_structure) is honoured.
import type { ExperiencePayload, SerendipEvent } from '@agentxp/protocol'
import type { Db } from './db.js'

export interface TraceReferenceRow {
  source_experience_id: string
  step_index: number
  reference_index: number
  referenced_event_id: string
  stale: number
  created_at: number
}

export type ValidateResult = { ok: true } | { ok: false; field: string }

// Structural validation per 02-data-model §4. If `reasoning_trace`
// is absent the relay MUST still accept the event (§4 normative).
export function validateTraceStructure(payload: ExperiencePayload): ValidateResult {
  if (payload.reasoning_trace === undefined || payload.reasoning_trace === null) {
    return { ok: true }
  }
  const t = payload.reasoning_trace as Record<string, unknown>
  if (typeof t !== 'object') {
    return { ok: false, field: 'reasoning_trace' }
  }
  if (!Array.isArray(t.steps)) {
    return { ok: false, field: 'reasoning_trace.steps' }
  }
  for (let i = 0; i < t.steps.length; i++) {
    const step = t.steps[i]
    if (typeof step !== 'object' || step === null) {
      return { ok: false, field: `reasoning_trace.steps[${i}]` }
    }
    const refs = (step as Record<string, unknown>).references
    if (refs !== undefined && !Array.isArray(refs)) {
      return { ok: false, field: `reasoning_trace.steps[${i}].references` }
    }
  }
  return { ok: true }
}

const HEX64 = /^[0-9a-f]{64}$/

export function indexTraceReferences(db: Db, event: SerendipEvent): void {
  const payload = event.payload as ExperiencePayload
  const trace = payload.reasoning_trace as
    | { steps: Array<{ references?: unknown }> }
    | undefined
  if (!trace || !Array.isArray(trace.steps)) return

  const checkExists = db.prepare(`SELECT 1 FROM events WHERE id = ? LIMIT 1`)
  const insert = db.prepare(
    `INSERT OR IGNORE INTO trace_references
       (source_experience_id, step_index, reference_index,
        referenced_event_id, stale, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )

  for (let stepIdx = 0; stepIdx < trace.steps.length; stepIdx++) {
    const step = trace.steps[stepIdx]
    const refs = step && Array.isArray(step.references) ? step.references : []
    for (let refIdx = 0; refIdx < refs.length; refIdx++) {
      const ref = refs[refIdx]
      if (typeof ref !== 'string' || !HEX64.test(ref)) continue
      const exists = checkExists.get(ref) !== undefined
      insert.run(event.id, stepIdx, refIdx, ref, exists ? 0 : 1, event.created_at)
    }
  }
}

export function getTrace(
  db: Db,
  experienceId: string,
): { reasoning_trace: unknown; references: TraceReferenceRow[] } | null {
  const row = db
    .prepare(`SELECT payload_json FROM events WHERE id = ?`)
    .get(experienceId) as { payload_json: string } | undefined
  if (!row) return null
  const payload = JSON.parse(row.payload_json) as ExperiencePayload
  if (payload.type !== 'experience') return null
  const references = db
    .prepare(
      `SELECT source_experience_id, step_index, reference_index,
              referenced_event_id, stale, created_at
         FROM trace_references
        WHERE source_experience_id = ?
        ORDER BY step_index, reference_index`,
    )
    .all(experienceId) as TraceReferenceRow[]
  return {
    reasoning_trace: payload.reasoning_trace ?? null,
    references,
  }
}
