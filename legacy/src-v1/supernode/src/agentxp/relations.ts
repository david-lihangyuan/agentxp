// Supernode AgentXP — Experience Dialogue Relations
// Stores extends / qualifies / supersedes links between experiences.
// Self-relations are rejected.

import type Database from 'better-sqlite3'
import { logger } from '../logger'

export type RelationType = 'extends' | 'qualifies' | 'supersedes'
const VALID_RELATION_TYPES: RelationType[] = ['extends', 'qualifies', 'supersedes']

export interface RelationRecord {
  id: number
  from_experience_id: number
  to_experience_id: number
  relation_type: RelationType
  pubkey: string
  created_at: number
}

export interface RelatedExperience {
  relation_id: number
  relation_type: RelationType
  direction: 'outgoing' | 'incoming'
  related_experience_id: number
  what: string
  outcome: string
  tags: string
  pubkey: string
  created_at: number
}

export class ExperienceRelations {
  constructor(private db: Database.Database) {}

  /**
   * Add a relation between two experiences.
   * Returns error if self-relation or invalid type.
   */
  addRelation(
    fromId: number,
    toId: number,
    relationType: RelationType,
    pubkey: string
  ): { ok: boolean; id?: number; error?: string } {
    // Reject self-relations
    if (fromId === toId) {
      return { ok: false, error: 'self-relation not allowed' }
    }

    // Validate relation type
    if (!VALID_RELATION_TYPES.includes(relationType)) {
      return { ok: false, error: `invalid relation type: ${relationType}` }
    }

    // Check both experiences exist
    const fromExp = this.db
      .prepare('SELECT id FROM experiences WHERE id = ?')
      .get(fromId) as { id: number } | undefined
    if (!fromExp) {
      return { ok: false, error: `source experience ${fromId} not found` }
    }

    const toExp = this.db
      .prepare('SELECT id FROM experiences WHERE id = ?')
      .get(toId) as { id: number } | undefined
    if (!toExp) {
      return { ok: false, error: `target experience ${toId} not found` }
    }

    try {
      const now = Math.floor(Date.now() / 1000)
      const result = this.db
        .prepare(`
          INSERT INTO experience_relations
            (from_experience_id, to_experience_id, relation_type, pubkey, created_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(fromId, toId, relationType, pubkey, now)

      logger.info('Experience relation added', {
        from_id: fromId,
        to_id: toId,
        relation_type: relationType,
      })

      return { ok: true, id: result.lastInsertRowid as number }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Unique constraint violation — duplicate relation
      if (msg.includes('UNIQUE constraint failed')) {
        return { ok: false, error: 'relation already exists' }
      }
      logger.error('Failed to add experience relation', { error: msg })
      return { ok: false, error: msg }
    }
  }

  /**
   * Get all relations for an experience (both outgoing and incoming).
   */
  getRelations(experienceId: number): RelatedExperience[] {
    const outgoing = this.db
      .prepare(`
        SELECT
          er.id AS relation_id,
          er.relation_type,
          'outgoing' AS direction,
          er.to_experience_id AS related_experience_id,
          e.what, e.outcome, e.tags, e.pubkey, e.created_at
        FROM experience_relations er
        JOIN experiences e ON er.to_experience_id = e.id
        WHERE er.from_experience_id = ?
        ORDER BY er.created_at DESC
      `)
      .all(experienceId) as RelatedExperience[]

    const incoming = this.db
      .prepare(`
        SELECT
          er.id AS relation_id,
          er.relation_type,
          'incoming' AS direction,
          er.from_experience_id AS related_experience_id,
          e.what, e.outcome, e.tags, e.pubkey, e.created_at
        FROM experience_relations er
        JOIN experiences e ON er.from_experience_id = e.id
        WHERE er.to_experience_id = ?
        ORDER BY er.created_at DESC
      `)
      .all(experienceId) as RelatedExperience[]

    return [...outgoing, ...incoming]
  }

  /**
   * Get direct relations for an experience (outgoing only, for search enrichment).
   */
  getDirectRelations(
    experienceId: number
  ): Array<{ target_id: number; relation_type: RelationType; what: string }> {
    return this.db
      .prepare(`
        SELECT
          er.to_experience_id AS target_id,
          er.relation_type,
          e.what
        FROM experience_relations er
        JOIN experiences e ON er.to_experience_id = e.id
        WHERE er.from_experience_id = ?
        ORDER BY er.created_at DESC
      `)
      .all(experienceId) as Array<{ target_id: number; relation_type: RelationType; what: string }>
  }
}
