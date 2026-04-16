/**
 * message-sending.ts — message_sending hook.
 *
 * Extracts keywords from outgoing message content and updates
 * the context_cache in the DB. Also tracks the last active session.
 *
 * Returns void — does not modify the message.
 */

import type { Db } from '../db.js'
import { setLastActiveSession } from './state.js'

// ─── Types (from SDK) ──────────────────────────────────────────────────────

export interface MessageSendingEvent {
  to: string
  content: string
  metadata?: Record<string, unknown>
}

export interface MessageSendingContext {
  channelId: string
  accountId?: string
  conversationId?: string
}

// ─── Keyword extraction ────────────────────────────────────────────────────

/**
 * Common English + Chinese stopwords to filter out.
 */
const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'out',
  'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
  'there', 'when', 'where', 'why', 'how', 'all', 'both', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'don',
  'now', 'and', 'but', 'or', 'if', 'it', 'its', 'this', 'that',
  'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'what',
  'which', 'who', 'whom',
  // Chinese (single-char stopwords)
  '\u7684', '\u4e86', '\u662f', '\u5728', '\u6211', '\u4f60', '\u4ed6', '\u5979', '\u5b83', '\u4eec',
  '\u8fd9', '\u90a3', '\u6709', '\u548c', '\u4e5f', '\u90fd', '\u4e0d', '\u5c31', '\u628a', '\u88ab',
  '\u8ba9', '\u4f1a', '\u80fd', '\u8981', '\u7528', '\u5230', '\u8bf4', '\u53bb', '\u770b', '\u6765',
  '\u7740', '\u8fc7', '\u5417', '\u5427', '\u5462', '\u554a', '\u54e6', '\u55ef',
  // Chinese (common two-char stopwords)
  '\u8fd9\u662f', '\u4e00\u4e2a', '\u7528\u6765', '\u53ef\u4ee5', '\u5df2\u7ecf',
  '\u4f46\u662f', '\u5982\u679c', '\u56e0\u4e3a', '\u6240\u4ee5', '\u4ee5\u53ca',
])

/**
 * Technical term pattern: PascalCase, dot-notation, slash-paths, etc.
 */
const TECHNICAL_RE = /^(?:[A-Z][a-z]+[A-Z]|[\w-]+\.[\w-]+|[\w-]+\/[\w-]+)/

/**
 * CJK Unified Ideographs range for Chinese character detection.
 */
const CJK_RE = /[\u4e00-\u9fff]/

/**
 * Extract bigrams from a CJK character sequence.
 * E.g. "测试验证" → ["测试", "试验", "验证"]
 */
function cjkBigrams(chars: string): string[] {
  const arr = Array.from(chars)
  if (arr.length < 2) return []
  const bigrams: string[] = []
  for (let i = 0; i < arr.length - 1; i++) {
    bigrams.push(arr[i] + arr[i + 1])
  }
  return bigrams
}

/**
 * Extract keywords from text content.
 * Keeps technical terms (PascalCase, dots, slashes), filters stopwords.
 * For CJK text, generates bigrams to approximate word boundaries.
 * Returns at most 20 keywords.
 */
export function extractKeywords(text: string): string[] {
  if (!text) return []

  // Split on whitespace and common ASCII punctuation
  const raw = text.split(/[\s,;:!?()[\]{}"'`<>]+/).filter(Boolean)

  // Further tokenise: separate CJK runs from non-CJK runs,
  // then produce bigrams from CJK sequences.
  const tokens: string[] = []
  for (const w of raw) {
    if (CJK_RE.test(w)) {
      // Split into CJK runs and non-CJK runs
      const parts = w.match(/[\u4e00-\u9fff\uff0c\u3002\uff01\uff1f]+|[^\u4e00-\u9fff\uff0c\u3002\uff01\uff1f]+/g) || []
      for (const part of parts) {
        if (/[\u4e00-\u9fff]/.test(part)) {
          // Strip CJK punctuation from edges
          const cleaned = part.replace(/[\uff0c\u3002\uff01\uff1f]/g, '')
          // Generate bigrams from CJK run
          const bgs = cjkBigrams(cleaned)
          if (bgs.length > 0) {
            tokens.push(...bgs)
          } else if (cleaned.length === 1) {
            tokens.push(cleaned)
          }
        } else {
          tokens.push(part)
        }
      }
    } else {
      tokens.push(w)
    }
  }

  const seen = new Set<string>()
  const techTerms: string[] = []
  const normalTerms: string[] = []

  for (const word of tokens) {
    // Strip trailing ASCII/CJK punctuation
    const cleaned = word.replace(/[.\u3002,\uff0c!\uff01?\uff1f]+$/, '')
    if (!cleaned || cleaned.length < 2) continue

    const lower = cleaned.toLowerCase()
    if (STOPWORDS.has(lower)) continue
    if (STOPWORDS.has(cleaned)) continue

    // Deduplicate (case-insensitive)
    if (seen.has(lower)) continue
    seen.add(lower)

    // Separate technical terms — preserve appearance order
    if (TECHNICAL_RE.test(cleaned)) {
      techTerms.push(cleaned)
    } else {
      normalTerms.push(lower)
    }

    if (techTerms.length + normalTerms.length >= 20) break
  }

  // Technical terms first (in order of appearance), then normal terms
  return [...techTerms, ...normalTerms].slice(0, 20)
}

// ─── Hook factory ──────────────────────────────────────────────────────────

export function createMessageSendingHook(db: Db) {
  return (event: MessageSendingEvent, ctx: MessageSendingContext): void => {
    try {
      const sessionKey = ctx.conversationId ?? ctx.channelId
      const keywords = extractKeywords(event.content)

      if (keywords.length > 0) {
        db.upsertContextCache({
          sessionId: sessionKey,
          keywords,
        })
        setLastActiveSession(sessionKey)
      }
    } catch {
      // never throw — don't block message sending
    }
  }
}
