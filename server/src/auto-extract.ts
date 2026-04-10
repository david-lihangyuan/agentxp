/**
 * AgentXP Auto-Extract: Webhook endpoint for automatic experience extraction
 * Phase 3.5 — POST /hooks/auto-extract + non-trivial filtering
 *
 * 接收 agent session transcript，自动提取经验并发布
 * 使用 OpenAI API（fetch，无额外依赖）
 *
 * Phase 3.5 新增过滤层:
 * 1. Transcript 复杂度预检（LLM 调用前拦截平凡 session）
 * 2. Specificity validator 收紧（要求文件路径/命令行/错误码等具体信号）
 * 3. 去重检查（cosine similarity > 0.85 的已有经验 → 跳过）
 */

// --- Types ---

export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  timestamp?: string;
}

export interface ExtractedExperience {
  what: string;
  context: string;
  tried: string;
  outcome: 'succeeded' | 'failed' | 'partial' | 'inconclusive';
  outcome_detail: string;
  learned: string;
  tags: string[];
  confidence: number;
}

export interface ExtractionResult {
  experiences: ExtractedExperience[];
  transcript_summary: string;
  extraction_time_ms: number;
  model: string;
  token_usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export type SessionType = 'original' | 'harvester' | 'routine';

export interface SessionClassification {
  type: SessionType;
  reason: string;
  agentName?: string;
}

export interface AutoExtractRequest {
  /** JSONL transcript string (OpenClaw session format) */
  transcript_jsonl?: string;
  /** OR: pre-parsed messages array */
  messages?: Array<{ role: string; content: string; timestamp?: string }>;
  /** Agent metadata */
  metadata?: {
    agent_id?: string;
    agent_name?: string;
    session_id?: string;
    platform?: string;
    framework?: string;
  };
  /** Override: skip classification, force extraction */
  force?: boolean;
  /** Override: don't publish, just return extracted experiences */
  dry_run?: boolean;
}

export interface AutoExtractResponse {
  status: 'extracted' | 'skipped' | 'empty' | 'error';
  /** Session classification */
  classification?: SessionClassification;
  /** Extraction result (if extracted) */
  extraction?: {
    summary: string;
    model: string;
    extraction_time_ms: number;
    token_usage?: ExtractionResult['token_usage'];
  };
  /** Published experiences */
  published?: Array<{
    experience_id: string;
    what: string;
    tags: string[];
  }>;
  /** Rejected experiences (with reason) */
  rejected?: Array<{
    what: string;
    reason: string;
  }>;
  /** Skip reason (if skipped) */
  skip_reason?: string;
  /** Error message */
  error?: string;
}

// --- Session Classifier ---

const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;

export function classifySession(content: string, agentName?: string): SessionClassification {
  // Rule 1: Agent name based filtering
  if (agentName) {
    const lower = agentName.toLowerCase();
    if (lower.includes('harvester') || lower.includes('collector') || lower.includes('scraper')) {
      return { type: 'harvester', reason: `agent name '${agentName}' indicates harvester role`, agentName };
    }
  }

  // Rule 2: Scan first N lines for patterns
  const lines = content.split('\n').slice(0, 50);
  let heartbeatCount = 0;
  let browseCount = 0;
  let editWriteCount = 0;
  let execCount = 0;
  let totalMessages = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type !== 'message') continue;
      totalMessages++;

      const msgContent = JSON.stringify(obj.message?.content || '');

      if (/HEARTBEAT|heartbeat-chain|HEARTBEAT_OK/i.test(msgContent)) heartbeatCount++;
      if (/\/api\/search|\/api\/browse|web_search|web_fetch/i.test(msgContent)) browseCount++;
      if (/"name"\s*:\s*"(edit|write|exec)"/i.test(msgContent)) {
        if (/"name"\s*:\s*"exec"/i.test(msgContent)) execCount++;
        else editWriteCount++;
      }
    } catch {
      continue;
    }
  }

  if (totalMessages > 0 && heartbeatCount / totalMessages > 0.3) {
    if (editWriteCount + execCount < 3) {
      return { type: 'routine', reason: `heartbeat-dominated (${heartbeatCount}/${totalMessages} messages)`, agentName };
    }
  }

  if (browseCount > 3 && editWriteCount < 2) {
    return { type: 'harvester', reason: `browse-heavy (${browseCount} browse, ${editWriteCount} edits)`, agentName };
  }

  return { type: 'original', reason: 'default — appears to be original work', agentName };
}

// --- Transcript Parser ---

export function parseTranscriptJsonl(jsonlContent: string): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];

  for (const line of jsonlContent.split('\n')) {
    if (!line.trim()) continue;

    try {
      const obj = JSON.parse(line);
      if (obj.type !== 'message') continue;

      const msg = obj.message;
      if (!msg) continue;

      const role = msg.role as string;
      const content = msg.content;

      if (typeof content === 'string') {
        if (content.length > 20) {
          messages.push({
            role: role as TranscriptMessage['role'],
            content: content.slice(0, 1000),
            timestamp: obj.timestamp,
          });
        }
      } else if (Array.isArray(content)) {
        const parts: string[] = [];

        for (const part of content) {
          if (part.type === 'text') {
            const text = part.text || '';
            // Skip system prompts
            if (text.length > 3000 && /HEARTBEAT|SOUL|AGENTS/.test(text)) continue;
            parts.push(text.slice(0, 500));
          } else if (part.type === 'tool_use') {
            const name = part.name || '?';
            const input = part.input || {};
            if (name === 'exec') parts.push(`[EXEC] ${(input.command || '').slice(0, 200)}`);
            else if (name === 'edit') parts.push(`[EDIT] ${input.path || ''}`);
            else if (name === 'read') parts.push(`[READ] ${input.path || ''}`);
            else if (name === 'write') parts.push(`[WRITE] ${input.path || ''}`);
          } else if (part.type === 'tool_result') {
            let resultText = '';
            if (typeof part.content === 'string') {
              resultText = part.content;
            } else if (Array.isArray(part.content)) {
              resultText = part.content
                .filter((x: any) => x?.type === 'text')
                .map((x: any) => x.text || '')
                .join(' ');
            }
            const lower = resultText.toLowerCase();
            const interesting = /error|fail|warning|not found|cannot|assert|fix|bug|deploy|pass/.test(lower);
            if (interesting || part.is_error) {
              parts.push(`[RESULT${part.is_error ? ' ERROR' : ''}] ${resultText.slice(0, 300)}`);
            }
          }
        }

        const combined = parts.join('\n');
        if (combined.length > 20) {
          messages.push({
            role: role as TranscriptMessage['role'],
            content: combined,
            timestamp: obj.timestamp,
          });
        }
      }
    } catch {
      // Skip unparseable lines
    }
  }

  return messages;
}

export function formatTranscript(messages: TranscriptMessage[], maxChars: number = 30000): string {
  let result = '';

  for (const msg of messages) {
    const prefix = msg.role === 'user' ? '>>> USER:' : '>>> ASSISTANT:';
    const entry = `${prefix}\n${msg.content}\n\n`;

    if (result.length + entry.length > maxChars) {
      result += '\n[... transcript truncated ...]\n';
      break;
    }

    result += entry;
  }

  return result;
}

// --- Phase 3.5: Transcript Complexity Pre-check ---

export interface ComplexityScore {
  score: number;           // 0-1, >= 0.3 to proceed with LLM
  signals: string[];       // what was detected
  skip_reason?: string;    // if score < threshold
}

/**
 * Pre-check transcript complexity BEFORE calling LLM.
 * Saves ~$0.001/call and ~5s latency for trivial sessions.
 * 
 * Signals detected:
 * - error/fix patterns (debugging activity)
 * - multi-step exec sequences (iterative problem-solving)
 * - edit+exec combos (code changes + testing)
 * - deploy/build/test patterns
 * - config/setup troubleshooting
 */
export function assessTranscriptComplexity(messages: TranscriptMessage[]): ComplexityScore {
  const signals: string[] = [];
  let score = 0;

  // Count action types
  let execCount = 0;
  let editCount = 0;
  let errorMentions = 0;
  let fixMentions = 0;
  let deployMentions = 0;
  let configMentions = 0;
  let debugSequences = 0;  // exec→error→edit→exec patterns
  let totalContent = '';

  // Track consecutive action patterns
  let lastAction: 'exec' | 'edit' | 'error' | 'other' = 'other';
  let sequenceLength = 0;

  for (const msg of messages) {
    const content = msg.content.toLowerCase();
    totalContent += content + ' ';

    // Count actions
    if (/\[exec\]/i.test(msg.content)) {
      execCount++;
      if (lastAction === 'edit' || lastAction === 'error') {
        sequenceLength++;
        if (sequenceLength >= 2) debugSequences++;
      }
      lastAction = 'exec';
    } else if (/\[edit\]|\[write\]/i.test(msg.content)) {
      editCount++;
      lastAction = 'edit';
      sequenceLength++;
    } else if (/\[result error\]|error|failed|cannot|not found/i.test(msg.content)) {
      errorMentions++;
      lastAction = 'error';
      sequenceLength++;
    } else {
      if (sequenceLength < 2) sequenceLength = 0;
      lastAction = 'other';
    }

    // Fix patterns
    if (/\bfix(ed|ing)?\b|\bresolved?\b|\bworkaround\b|\bsolution\b/i.test(content)) {
      fixMentions++;
    }

    // Deploy/build patterns
    if (/\bdeploy|\bbuild|\bcompil|\btest.*pass|\btest.*fail|npm (run|test)|cargo|make\b/i.test(content)) {
      deployMentions++;
    }

    // Config troubleshooting
    if (/\bconfig|\bsetting|\benv|\bparam|\bflag|\boption.*=|--[a-z]/i.test(content)) {
      configMentions++;
    }
  }

  // Scoring
  if (errorMentions >= 2) { score += 0.2; signals.push(`errors:${errorMentions}`); }
  if (fixMentions >= 1) { score += 0.15; signals.push(`fixes:${fixMentions}`); }
  if (debugSequences >= 1) { score += 0.25; signals.push(`debug-sequences:${debugSequences}`); }
  if (execCount >= 3 && editCount >= 1) { score += 0.15; signals.push(`exec+edit:${execCount}+${editCount}`); }
  if (deployMentions >= 2) { score += 0.1; signals.push(`deploy:${deployMentions}`); }
  if (configMentions >= 3) { score += 0.1; signals.push(`config:${configMentions}`); }

  // Penalty: very short sessions
  if (messages.length < 6) { score -= 0.2; signals.push(`short:${messages.length}msgs`); }

  // Penalty: mostly reads (no edits, no execs)
  if (execCount === 0 && editCount === 0) {
    score -= 0.3;
    signals.push('no-actions');
  }

  // Cap at [0, 1]
  score = Math.max(0, Math.min(1, score));

  const result: ComplexityScore = { score, signals };
  if (score < 0.3) {
    result.skip_reason = `Low complexity (${score.toFixed(2)}): ${signals.join(', ')}`;
  }
  return result;
}

// --- Phase 3.5: Duplicate Detection ---

/**
 * Check if a new experience is too similar to existing ones from the same agent.
 * Returns the duplicate experience's 'what' if found, null otherwise.
 * Uses simple text similarity (Jaccard on words) — no embedding needed at filter time.
 */
export function isDuplicate(
  newExp: ExtractedExperience,
  existingExperiences: Array<{ what: string; learned: string; tags: string[] }>,
  threshold: number = 0.6
): { isDuplicate: boolean; similarTo?: string; similarity: number } {
  const newWords = new Set(
    `${newExp.what} ${newExp.learned}`.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );

  let maxSim = 0;
  let similarTo: string | undefined;

  for (const existing of existingExperiences) {
    const existWords = new Set(
      `${existing.what} ${existing.learned}`.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2)
    );

    // Jaccard similarity
    const intersection = [...newWords].filter(w => existWords.has(w)).length;
    const union = new Set([...newWords, ...existWords]).size;
    const sim = union > 0 ? intersection / union : 0;

    // Also check tag overlap
    const newTags = new Set(newExp.tags);
    const existTags = new Set(existing.tags);
    const tagOverlap = [...newTags].filter(t => existTags.has(t)).length;
    const tagUnion = new Set([...newTags, ...existTags]).size;
    const tagSim = tagUnion > 0 ? tagOverlap / tagUnion : 0;

    // Combined: 70% text, 30% tags
    const combined = sim * 0.7 + tagSim * 0.3;

    if (combined > maxSim) {
      maxSim = combined;
      similarTo = existing.what;
    }
  }

  return {
    isDuplicate: maxSim >= threshold,
    similarTo: maxSim >= threshold ? similarTo : undefined,
    similarity: maxSim,
  };
}

// --- Extraction Prompt ---

const EXTRACTION_SYSTEM_PROMPT = `You are an experience extraction engine for AgentXP — a cross-agent experience sharing network.

Your job: Read an AI agent's session transcript and extract reusable technical experiences that other agents could learn from.

## CRITICAL: First-party only
Only extract experiences from actions the agent PERFORMED ITSELF in this session.
Do NOT extract from content the agent read, browsed, or summarized from other sources.

## What counts as an experience
A concrete problem-solving episode with a specific problem, what was tried, actual outcome, and non-obvious specific insight learned.

## What to SKIP
- Routine file reads, status checks, listing operations
- Task planning, scheduling, memory/journal updates
- Conversations without technical problem-solving
- Generic knowledge any LLM already knows
- Incremental coding steps — extract at FEATURE or BUG-FIX level
- Heartbeat check-ins, cron reports

## Quality rules
1. Extract at FEATURE or BUG-FIX level
2. Self-contained experiences
3. Typically 0-2 per session
4. "learned" MUST be specific and actionable with concrete details (file names, parameters, error codes, thresholds)
5. Tags MUST be lowercase English only — no CJK characters
6. Empty array for routine sessions

## Output format
Return ONLY a JSON object:
{
  "experiences": [{
    "what": "One-line summary (≤100 chars)",
    "context": "Tech stack, environment (≤300 chars)",
    "tried": "What was tried (≤500 chars)",
    "outcome": "succeeded|failed|partial|inconclusive",
    "outcome_detail": "What happened (≤500 chars)",
    "learned": "Specific, actionable insight with concrete details (≤500 chars)",
    "tags": ["lowercase", "english", "only"],
    "confidence": 0.0-1.0
  }],
  "transcript_summary": "One-sentence summary"
}

Only return experiences with confidence >= 0.7. Return empty array if nothing qualifies.`;

// --- LLM Extraction (fetch-based, no openai package needed) ---

export async function extractExperiences(
  transcript: string,
  apiKey: string,
  options?: {
    model?: string;
    baseUrl?: string;
  }
): Promise<ExtractionResult> {
  const model = options?.model || 'gpt-4o-mini';
  const baseUrl = (options?.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');

  const startTime = Date.now();

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: `Extract experiences from this session transcript:\n\n${transcript}` },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });

  const extractionTimeMs = Date.now() - startTime;

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json() as any;
  const rawContent = data.choices?.[0]?.message?.content || '{}';

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    parsed = { experiences: [], transcript_summary: 'Failed to parse extraction result' };
  }

  const experiences: ExtractedExperience[] = (parsed.experiences || [])
    .filter((e: any) => (e.confidence || 0) >= 0.7)
    .map((e: any) => ({
      what: String(e.what || '').slice(0, 100),
      context: String(e.context || '').slice(0, 300),
      tried: String(e.tried || '').slice(0, 500),
      outcome: ['succeeded', 'failed', 'partial', 'inconclusive'].includes(e.outcome)
        ? e.outcome
        : 'inconclusive',
      outcome_detail: String(e.outcome_detail || '').slice(0, 500),
      learned: String(e.learned || '').slice(0, 500),
      tags: Array.isArray(e.tags)
        ? e.tags.map((t: any) => String(t).toLowerCase().slice(0, 50)).slice(0, 10)
        : [],
      confidence: Math.min(1, Math.max(0, Number(e.confidence) || 0)),
    }));

  return {
    experiences,
    transcript_summary: String(parsed.transcript_summary || '').slice(0, 200),
    extraction_time_ms: extractionTimeMs,
    model,
    token_usage: data.usage ? {
      prompt_tokens: data.usage.prompt_tokens,
      completion_tokens: data.usage.completion_tokens,
      total_tokens: data.usage.total_tokens,
    } : undefined,
  };
}

// --- Validation (v2 stricter) ---

const GENERIC_PHRASES = [
  'it worked as expected', 'the solution was straightforward',
  'always follow best practices', 'this is a common issue',
  'can significantly', 'can help with', 'is important for',
  'should be considered', 'it is recommended', 'use automation',
  'helps with maintainability', 'improves efficiency',
  'reduces errors', 'ensure proper configuration',
];

// Phase 3.5: Tightened specificity — requires file paths, CLI flags, error codes,
// or version numbers. Removed overly broad terms like 'error', 'api', 'config'
// that match too many generic statements.
// Error pattern: require colon after 'error' (e.g. "error: ENOENT", "Error: timeout").
// "error messages" or "error handling" should NOT match — /i flag makes [A-Z] useless.
const SPECIFICITY_REGEX = /[\/][\w.-]+[\/.]\w+|`[^`]{3,}`|\d{3,}|--[a-z][a-z-]+|\berror:\s*\S+|\bv\d+\.\d+|\b\w+\.\w+\.(ts|js|py|rs|go|yaml|yml|json|toml|sql|sh|md)\b|\bport \d+|\bstatus \d{3}|\b0x[0-9a-f]+/i;

export function validateExperiences(experiences: ExtractedExperience[]): {
  valid: ExtractedExperience[];
  rejected: Array<{ experience: ExtractedExperience; reason: string }>;
} {
  const valid: ExtractedExperience[] = [];
  const rejected: Array<{ experience: ExtractedExperience; reason: string }> = [];

  for (const exp of experiences) {
    if (exp.learned.length < 50) {
      rejected.push({ experience: exp, reason: 'learned too short (< 50 chars)' });
      continue;
    }
    if (exp.tried.length < 30) {
      rejected.push({ experience: exp, reason: 'tried too short (< 30 chars)' });
      continue;
    }

    const learnedLower = exp.learned.toLowerCase();
    if (GENERIC_PHRASES.some(p => learnedLower.includes(p))) {
      rejected.push({ experience: exp, reason: 'learned contains generic phrase' });
      continue;
    }

    // Remove CJK tags
    exp.tags = exp.tags.filter(t => !CJK_REGEX.test(t));
    if (exp.tags.length < 2) {
      rejected.push({ experience: exp, reason: 'too few English tags (< 2 after CJK removal)' });
      continue;
    }

    if (!SPECIFICITY_REGEX.test(exp.learned)) {
      rejected.push({ experience: exp, reason: 'learned lacks specific/actionable detail' });
      continue;
    }

    if (exp.confidence < 0.7) {
      rejected.push({ experience: exp, reason: `confidence ${exp.confidence} < 0.7 threshold` });
      continue;
    }

    valid.push(exp);
  }

  return { valid, rejected };
}
