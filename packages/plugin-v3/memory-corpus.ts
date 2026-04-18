/**
 * memory-corpus.ts — CorpusSupplement for AgentXP v3
 * 
 * Implements OpenClaw memory corpus interface for AgentXP experiences.
 * Supports:
 * - Local reflections + distilled
 * - Network experiences (when mode='network')
 * - Summary-first search results
 * - Full content on demand via get()
 */

import type { Db, Reflection, Distilled, NetworkExperience } from './db.js';

// ─── OpenClaw Memory Corpus Types ──────────────────────────────────────────

export interface MemoryCorpusSearchResult {
  corpus: string;
  path: string;
  title?: string;
  kind?: string;
  score: number;
  snippet: string;
  id?: string;
  citation?: string;
  provenanceLabel?: string;
  sourceType?: string;
}

export interface MemoryCorpusGetResult {
  corpus: string;
  path: string;
  title?: string;
  kind?: string;
  content: string;
  fromLine: number;
  lineCount: number;
  id?: string;
  provenanceLabel?: string;
  sourceType?: string;
}

export interface MemoryCorpusSupplement {
  search(params: {
    query: string;
    maxResults?: number;
    agentSessionKey?: string;
  }): Promise<MemoryCorpusSearchResult[]>;

  get(params: {
    lookup: string;
    fromLine?: number;
    lineCount?: number;
    agentSessionKey?: string;
  }): Promise<MemoryCorpusGetResult | null>;
}

// ─── Config ────────────────────────────────────────────────────────────────

export interface CorpusConfig {
  mode?: 'local' | 'network';
}

// ─── Factory ───────────────────────────────────────────────────────────────

export function createCorpusSupplement(
  db: Db,
  config: CorpusConfig = {},
): MemoryCorpusSupplement {
  return {
    async search({ query, maxResults = 10 }) {
      const results: MemoryCorpusSearchResult[] = [];
      let remaining = maxResults;

      // Step 1: Search reflections (FTS5)
      const reflections = db.searchReflectionsFts.all(query) as Reflection[];
      for (const r of reflections.slice(0, remaining)) {
        const tags = r.tags ? JSON.parse(r.tags).join(', ') : '';
        results.push({
          corpus: 'agentxp',
          path: `agentxp://reflection/${r.id}`,
          title: r.title,
          kind: 'reflection',
          score: r.quality_score,
          snippet: `- [${r.category}] ${r.title} — ${r.outcome} — ${tags}`,
          id: String(r.id),
          citation: `[AgentXP reflection #${r.id}]`,
          provenanceLabel: 'AgentXP',
          sourceType: 'reflection',
        });
      }
      remaining -= reflections.length;

      // Step 2: Search distilled (FTS5)
      if (remaining > 0) {
        const distilled = db.searchDistilledFts.all(query) as Distilled[];
        for (const d of distilled.slice(0, remaining)) {
          // Deduplicate: skip if already have a reflection with same ID
          const lookupKey = `agentxp://distilled/${d.id}`;
          if (results.some(r => r.path === lookupKey)) continue;

          results.push({
            corpus: 'agentxp',
            path: lookupKey,
            title: d.title,
            kind: 'distilled',
            score: d.confidence,
            snippet: `- [${d.category}] ${d.title} — ${d.summary} — applied ${d.applied_count}/success ${d.success_count}`,
            id: String(d.id),
            citation: `[AgentXP distilled #${d.id}]`,
            provenanceLabel: 'AgentXP',
            sourceType: 'distilled',
          });
        }
        remaining -= distilled.length;
      }

      // Step 3: Search network experiences (when mode='network')
      // Per design doc: FTS5/LIKE search on title/tried/learned, include trust_score
      if (config.mode === 'network' && remaining > 0) {
        const networkResults = db.db
          .prepare(
            `SELECT id, category, title, tried, outcome, learned, tags, trust_score, pulse_state
             FROM network_experiences
             WHERE title LIKE ? OR tried LIKE ? OR learned LIKE ?
             LIMIT ?`
          )
          .all(
            `%${query}%`,
            `%${query}%`,
            `%${query}%`,
            remaining
          ) as NetworkExperience[];

        for (const n of networkResults) {
          const tags = n.tags ? JSON.parse(n.tags).join(', ') : '';
          results.push({
            corpus: 'agentxp',
            path: `agentxp://network/${n.id}`,
            title: n.title,
            kind: 'network',
            score: n.trust_score,
            snippet: `- [${n.category || 'network'}] ${n.title} — ${n.outcome} — ${tags} [trust:${n.trust_score}]`,
            id: String(n.id),
            citation: `[AgentXP network #${n.id}]`,
            provenanceLabel: 'AgentXP Network',
            sourceType: 'network',
          });
        }
      }

      return results;
    },

    async get({ lookup }) {
      // Parse lookup: agentxp://reflection/123, agentxp://distilled/456, agentxp://network/789
      const match = lookup.match(/^agentxp:\/\/(reflection|distilled|network)\/(\d+)$/);
      if (!match) return null;

      const [, type, idStr] = match;
      const id = parseInt(idStr, 10);

      if (type === 'reflection') {
        const reflection = db.db
          .prepare('SELECT * FROM reflections WHERE id = ?')
          .get(id) as Reflection | undefined;
        if (!reflection) return null;

        const tags = reflection.tags ? JSON.parse(reflection.tags).join(', ') : '';
        const content = [
          `## ${reflection.title}`,
          '',
          `**Category:** ${reflection.category}`,
          `**Tried:** ${reflection.tried}`,
          `**Expected:** ${reflection.expected}`,
          `**Outcome:** ${reflection.outcome}`,
          `**Learned:** ${reflection.learned}`,
          reflection.why_wrong ? `**Why wrong:** ${reflection.why_wrong}` : '',
          `**Tags:** ${tags}`,
          `**Quality score:** ${reflection.quality_score}`,
          `**Created:** ${new Date(reflection.created_at).toISOString()}`,
        ]
          .filter(Boolean)
          .join('\n');

        return {
          corpus: 'agentxp',
          path: lookup,
          title: reflection.title,
          kind: 'reflection',
          content,
          fromLine: 1,
          lineCount: content.split('\n').length,
          id: String(id),
          provenanceLabel: 'AgentXP',
          sourceType: 'reflection',
        };
      }

      if (type === 'distilled') {
        const distilled = db.db
          .prepare('SELECT * FROM distilled WHERE id = ?')
          .get(id) as Distilled | undefined;
        if (!distilled) return null;

        const sourceIds = distilled.source_ids ? JSON.parse(distilled.source_ids).join(', ') : '';
        const content = [
          `## ${distilled.title}`,
          '',
          `**Category:** ${distilled.category}`,
          `**Summary:** ${distilled.summary}`,
          `**Source IDs:** ${sourceIds}`,
          `**Confidence:** ${distilled.confidence}`,
          `**Applied:** ${distilled.applied_count} times`,
          `**Success:** ${distilled.success_count} times`,
          `**Created:** ${new Date(distilled.created_at).toISOString()}`,
          `**Updated:** ${new Date(distilled.updated_at).toISOString()}`,
        ].join('\n');

        return {
          corpus: 'agentxp',
          path: lookup,
          title: distilled.title,
          kind: 'distilled',
          content,
          fromLine: 1,
          lineCount: content.split('\n').length,
          id: String(id),
          provenanceLabel: 'AgentXP',
          sourceType: 'distilled',
        };
      }

      if (type === 'network') {
        const network = db.db
          .prepare('SELECT * FROM network_experiences WHERE id = ?')
          .get(id) as NetworkExperience | undefined;
        if (!network) return null;

        const tags = network.tags ? JSON.parse(network.tags).join(', ') : '';
        const scope = network.scope ? JSON.parse(network.scope).join(', ') : '';
        const content = [
          `## ${network.title}`,
          '',
          `**Category:** ${network.category || 'unknown'}`,
          `**Tried:** ${network.tried}`,
          `**Outcome:** ${network.outcome}`,
          `**Learned:** ${network.learned}`,
          `**Tags:** ${tags}`,
          `**Scope:** ${scope}`,
          `**Trust score:** ${network.trust_score}`,
          `**Pulse state:** ${network.pulse_state}`,
          `**Pulled:** ${new Date(network.pulled_at).toISOString()}`,
        ]
          .filter(Boolean)
          .join('\n');

        return {
          corpus: 'agentxp',
          path: lookup,
          title: network.title,
          kind: 'network',
          content,
          fromLine: 1,
          lineCount: content.split('\n').length,
          id: String(id),
          provenanceLabel: 'AgentXP Network',
          sourceType: 'network',
        };
      }

      return null;
    },
  };
}
