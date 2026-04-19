/**
 * message-sending.ts — message_sending hook.
 *
 * Extracts keywords from outgoing message content and updates context_cache.
 * Parses structured reflections from message content and stores them.
 * Marks session as not-first-message after first message.
 * Never blocks messages (always returns void or { cancel: false }).
 */

import type { Db, ReflectionOutcome } from '../db.js';
import { parseMultipleReflections, classifyCategory } from '../extraction.js';
import { setLastActiveSession, getLastActiveSession } from './state.js';

export interface MessageSendingEvent {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MessageSendingContext {
  channelId: string;
  accountId?: string;
  conversationId?: string;
  sessionId?: string;
}

// Stopwords for keyword extraction
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'should', 'could', 'may', 'might', 'must', 'can', 'i', 'you',
  'he', 'she', 'it', 'we', 'they', 'this', 'that', 'these', 'those',
  'my', 'your', 'his', 'her', 'its', 'our', 'their', 'me', 'him', 'her',
  'us', 'them', 'what', 'which', 'who', 'when', 'where', 'why', 'how'
]);

/**
 * Extract keywords from text content.
 * Keeps technical terms (PascalCase, dots, slashes), filters stopwords.
 * Returns at most 20 keywords.
 */
export function extractKeywords(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  
  // Remove markdown code blocks to reduce noise
  const cleaned = text.replace(/```[\s\S]*?```/g, ' ');
  
  // Split on word boundaries, keep technical patterns
  const tokens = cleaned
    .split(/[\s,;:!?()[\]{}]+/)
    .filter(t => t.length > 2);
  
  const keywords = new Set<string>();
  
  for (const token of tokens) {
    const lower = token.toLowerCase();
    
    // Skip stopwords
    if (STOPWORDS.has(lower)) continue;
    
    // Keep technical terms (has dots, slashes, or PascalCase)
    if (/[./]/.test(token) || /[A-Z][a-z]+[A-Z]/.test(token)) {
      keywords.add(token);
      continue;
    }
    
    // Keep longer words
    if (token.length >= 4) {
      keywords.add(lower);
    }
  }
  
  return Array.from(keywords).slice(0, 20);
}

export function createMessageSendingHook(db: Db) {
  return (event: MessageSendingEvent, ctx: MessageSendingContext): void => {
    const sessionId = ctx.sessionId || getLastActiveSession();
    if (!sessionId) return;
    
    // Update shared state
    setLastActiveSession(sessionId);
    
    const content = event.content || '';
    
    // Always update context cache (at minimum mark first_message = false)
    const cache = db.getContextCache.get(sessionId) as any;
    if (cache) {
      // Extract and merge keywords
      const keywords = extractKeywords(content);
      const existingKeywords = JSON.parse(cache.keywords || '[]') as string[];
      const merged = keywords.length > 0
        ? Array.from(new Set([...existingKeywords, ...keywords]))
        : existingKeywords;

      (db.upsertContextCache as any).run(
        sessionId,
        JSON.stringify(merged.slice(0, 50)),
        cache.tool_count,
        'false', // not first message anymore
        cache.checkpoint_due,
        Date.now()
      );
    }
    
    // Parse structured reflections from message content
    const reflections = parseMultipleReflections(content);
    
    for (const ref of reflections) {
      // Classify category
      const category = classifyCategory({
        outcome: ref.outcome,
        learned: ref.learned,
        tags: ref.tags
      });
      
      // Insert into DB.
      // Schema (16 cols): session_id, source_file, category, title, tried,
      //   expected, outcome, learned, why_wrong, tags, quality_score,
      //   published, relay_event_id, visibility, created_at, updated_at.
      // Historical bug (fixed 2026-04-17): this call passed 13 args, SQLite
      // threw "Too few parameter values were provided" and the exception
      // bubbled up into the plugin SDK, silently dropping every reflection
      // the agent tried to persist via message_sending for weeks.
      const now = Date.now();
      try {
        (db.insertReflection as any).run(
          sessionId,         // session_id
          null,              // source_file (captured at message_sending, no file)
          category,          // category
          ref.title,         // title
          ref.tried || '',   // tried
          ref.expected || '',// expected
          ref.outcome || 'partial', // outcome
          ref.learned || '', // learned
          ref.whyWrong || null,     // why_wrong
          JSON.stringify(ref.tags), // tags
          0.0,               // quality_score (computed later by service.tick)
          0,                 // published
          null,              // relay_event_id (not yet published)
          'auto',            // visibility (classified later)
          now,               // created_at
          now,               // updated_at
        );
      } catch (err) {
        // Never let a single bad reflection break the message pipeline,
        // but make it loud enough to notice instead of silently losing data.
         
        console.error(
          `[agentxp:message-sending] insertReflection failed for session=${sessionId} title="${ref.title}":`,
          (err as Error)?.message ?? err,
        );
      }
    }
  };
}
