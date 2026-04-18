import type Database from 'better-sqlite3';
import { toSerendipEvent, type LocalReflection } from './serendip.js';

export interface PublishResult {
  published: number;
  failed: number;
  errors: Array<{ id: number; error: string }>;
}

export interface PublishConfig {
  relayUrl: string;
  agentKey: string;
  operatorPubkey: string;
}

/**
 * Publish unpublished reflections to the Relay.
 * 
 * Only publishes reflections with:
 * - published = 0 (not yet published)
 * - quality_score > 0.5 (high quality)
 * - visibility != 'private' (not private)
 * 
 * After successful publish, marks reflection as published and stores relay_event_id.
 */
export async function publishPending(
  db: Database.Database,
  config: PublishConfig
): Promise<PublishResult> {
  // Get unpublished reflections with quality_score > 0.5
  const rows = db.prepare(`
    SELECT * FROM reflections
    WHERE published = 0
      AND quality_score > 0.5
      AND visibility != 'private'
    ORDER BY created_at ASC
    LIMIT 10
  `).all() as Array<{
    id: number;
    title: string;
    tried: string;
    expected: string | null;
    outcome: string;
    learned: string;
    why_wrong: string | null;
    tags: string;
    visibility: string;
    created_at: number;
  }>;

  const agentPrivkey = Buffer.from(config.agentKey, 'hex');
  const result: PublishResult = { published: 0, failed: 0, errors: [] };

  for (const row of rows) {
    try {
      // Parse tags from JSON
      let tags: string[] = [];
      try {
        tags = JSON.parse(row.tags);
      } catch {
        tags = [];
      }

      // Convert to LocalReflection format
      const reflection: LocalReflection = {
        id: row.id,
        title: row.title,
        tried: row.tried,
        expected: row.expected,
        outcome: row.outcome,
        learned: row.learned,
        why_wrong: row.why_wrong,
        tags,
        visibility: row.visibility,
        created_at: row.created_at,
      };

      // Convert to Serendip Event
      const event = await toSerendipEvent(reflection, agentPrivkey, config.operatorPubkey);

      // Send to relay
      const res = await fetch(`${config.relayUrl}/api/v1/experiences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      // Mark as published
      db.prepare(`
        UPDATE reflections
        SET published = 1, relay_event_id = ?, updated_at = ?
        WHERE id = ?
      `).run(event.id, Date.now(), row.id);

      result.published++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        id: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
