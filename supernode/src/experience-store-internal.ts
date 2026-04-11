/**
 * 内部工具：行转 Experience 对象
 * 供 experience-store.ts 和 experience-search.ts 共用
 */
import type { Experience, PulseState } from './experience-store.js'

export function rowToExperience(row: Record<string, unknown>): Experience {
  return {
    id: row.id as string,
    event_id: row.event_id as string,
    operator_pubkey: row.operator_pubkey as string,
    title: row.title as string,
    summary: row.summary as string,
    tags: JSON.parse((row.tags as string) || '[]') as string[],
    difficulty: (row.difficulty ?? undefined) as string | undefined,
    outcome: (row.outcome ?? undefined) as string | undefined,
    embedding: row.embedding
      ? (JSON.parse(row.embedding as string) as number[])
      : undefined,
    pulse_state: row.pulse_state as PulseState,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  }
}
