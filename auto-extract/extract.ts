/**
 * AgentXP Auto-Extract: Extract experiences from agent session transcripts
 * Phase 3.2: Improved prompt + validation (v2)
 */

import OpenAI from 'openai';

// --- Types ---

interface ExtractedExperience {
  what: string;       // ≤ 100 chars
  context: string;    // ≤ 300 chars
  tried: string;      // ≤ 500 chars
  outcome: 'succeeded' | 'failed' | 'partial' | 'inconclusive';
  outcome_detail: string; // ≤ 500 chars
  learned: string;    // ≤ 500 chars
  tags: string[];
  confidence: number; // 0-1
}

interface ExtractionResult {
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

interface TranscriptMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  timestamp?: string;
}

// --- Extraction Prompt ---

import { readFileSync } from 'fs';
import { join } from 'path';

// Load prompt from external file for easier iteration
function loadPrompt(): string {
  // Try multiple locations: next to compiled .js, and next to source .ts
  const candidates = [
    join(__dirname, 'extract-prompt-v2.txt'),
    join(__dirname, '..', 'extract-prompt-v2.txt'),
    join(process.cwd(), 'extract-prompt-v2.txt'),
  ];
  for (const p of candidates) {
    try {
      const content = readFileSync(p, 'utf-8');
      // Strip comment lines (# ...) at the top
      const lines = content.split('\n');
      const startIdx = lines.findIndex(l => !l.startsWith('#') && l.trim() !== '');
      return lines.slice(startIdx >= 0 ? startIdx : 0).join('\n').trim();
    } catch {
      continue;
    }
  }
  return EXTRACTION_SYSTEM_PROMPT_FALLBACK;
}

// Fallback prompt (v2 inline) in case file loading fails
const EXTRACTION_SYSTEM_PROMPT_FALLBACK = `You are an experience extraction engine for AgentXP — a cross-agent experience sharing network.

Your job: Read an AI agent's session transcript and extract reusable technical experiences that other agents could learn from.

CRITICAL: Only extract experiences from actions the agent PERFORMED ITSELF. Do NOT extract from content the agent read, browsed, or summarized from other sources.

## What counts as an experience
A concrete problem-solving episode with:
- A specific problem or challenge the agent encountered
- What the agent tried (approaches, commands, code changes)
- The actual outcome (success, failure, partial)
- A non-obvious, specific insight learned

## What to SKIP
- Routine file reads, status checks, listing operations
- Task planning, scheduling, organization
- Memory/journal updates
- Conversations without technical problem-solving
- Generic knowledge any LLM already knows
- Incremental coding steps — extract at FEATURE or BUG-FIX level
- Heartbeat check-ins, cron reports
- Content the agent read from other agents' experiences

## Quality rules
1. Extract at FEATURE or BUG-FIX level
2. Self-contained experiences
3. Typically 0-2 per session
4. "learned" MUST be specific and actionable with concrete details
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

Only return experiences with confidence >= 0.7.`;

const EXTRACTION_SYSTEM_PROMPT = loadPrompt();

// --- Session Pre-classifier ---

type SessionType = 'original' | 'harvester' | 'routine';

interface SessionClassification {
  type: SessionType;
  reason: string;
  agentName?: string;
}

/**
 * Classify a session before extraction.
 * Returns 'original' for sessions where the agent does real work,
 * 'harvester' for sessions that just collect/relay others' content,
 * 'routine' for pure heartbeat/status/memory sessions.
 */
export function classifySession(jsonlContent: string, agentName?: string): SessionClassification {
  // Rule 1: Agent name based filtering
  if (agentName) {
    const lower = agentName.toLowerCase();
    if (lower.includes('harvester') || lower.includes('collector') || lower.includes('scraper')) {
      return { type: 'harvester', reason: `agent name '${agentName}' indicates harvester role`, agentName };
    }
  }

  // Rule 2: Scan first N lines for patterns
  const lines = jsonlContent.split('\n').slice(0, 50);
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

      const content = JSON.stringify(obj.message?.content || '');

      // Heartbeat / routine patterns
      if (/HEARTBEAT|heartbeat-chain|HEARTBEAT_OK/i.test(content)) {
        heartbeatCount++;
      }
      // Browse/search = reading others' content
      if (/\/api\/search|\/api\/browse|web_search|web_fetch/i.test(content)) {
        browseCount++;
      }
      // Creating/editing files = original work
      if (/"name"\s*:\s*"(edit|write|exec)"/i.test(content)) {
        if (/"name"\s*:\s*"exec"/i.test(content)) execCount++;
        else editWriteCount++;
      }
    } catch {
      continue;
    }
  }

  // Rule 3: Heartbeat-dominated sessions
  if (totalMessages > 0 && heartbeatCount / totalMessages > 0.3) {
    // Check if it also does real work
    if (editWriteCount + execCount < 3) {
      return { type: 'routine', reason: `heartbeat-dominated (${heartbeatCount}/${totalMessages} messages)`, agentName };
    }
  }

  // Rule 4: Browse-heavy with few edits = probably harvester-like
  if (browseCount > 3 && editWriteCount < 2) {
    return { type: 'harvester', reason: `browse-heavy (${browseCount} browse, ${editWriteCount} edits)`, agentName };
  }

  return { type: 'original', reason: 'default — appears to be original work', agentName };
}

// --- Core Functions ---

/**
 * Parse an OpenClaw session JSONL file into readable transcript messages
 */
export function parseTranscript(jsonlContent: string): TranscriptMessage[] {
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
            role: role as any,
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
            if (text.length > 3000 && /HEARTBEAT|SOUL|AGENTS/.test(text)) {
              continue;
            }
            parts.push(text.slice(0, 500));
          } else if (part.type === 'tool_use') {
            const name = part.name || '?';
            const input = part.input || {};
            if (name === 'exec') {
              parts.push(`[EXEC] ${(input.command || '').slice(0, 200)}`);
            } else if (name === 'edit') {
              parts.push(`[EDIT] ${input.path || ''}`);
            } else if (name === 'read') {
              parts.push(`[READ] ${input.path || ''}`);
            } else if (name === 'write') {
              parts.push(`[WRITE] ${input.path || ''}`);
            }
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
            // Only keep interesting results
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
            role: role as any,
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

/**
 * Format transcript messages into a string for LLM consumption.
 * Respects token budget by truncating if needed.
 */
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

/**
 * Extract experiences from a transcript using LLM
 */
export async function extractExperiences(
  transcript: string,
  options: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    minConfidence?: number;
  }
): Promise<ExtractionResult> {
  const model = options.model || 'gpt-4o-mini';
  const minConfidence = options.minConfidence || 0.7;
  
  const openai = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl,
  });
  
  const startTime = Date.now();
  
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: `Extract experiences from this session transcript:\n\n${transcript}` },
    ],
    temperature: 0.3,  // Lower temperature for more consistent extraction
    response_format: { type: 'json_object' },
  });
  
  const extractionTimeMs = Date.now() - startTime;
  const rawContent = response.choices[0]?.message?.content || '{}';
  
  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    parsed = { experiences: [], transcript_summary: 'Failed to parse extraction result' };
  }
  
  // Filter by confidence and validate
  const experiences: ExtractedExperience[] = (parsed.experiences || [])
    .filter((e: any) => (e.confidence || 0) >= minConfidence)
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
    token_usage: response.usage ? {
      prompt_tokens: response.usage.prompt_tokens,
      completion_tokens: response.usage.completion_tokens,
      total_tokens: response.usage.total_tokens,
    } : undefined,
  };
}

// CJK Unicode ranges for tag validation
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;

/**
 * Quality check: validate extracted experiences (v2 — stricter)
 */
export function validateExperiences(experiences: ExtractedExperience[]): {
  valid: ExtractedExperience[];
  rejected: Array<{ experience: ExtractedExperience; reason: string }>;
} {
  const valid: ExtractedExperience[] = [];
  const rejected: Array<{ experience: ExtractedExperience; reason: string }> = [];
  
  for (const exp of experiences) {
    // Check minimum content length
    if (exp.learned.length < 50) {
      rejected.push({ experience: exp, reason: 'learned too short (< 50 chars)' });
      continue;
    }
    if (exp.tried.length < 30) {
      rejected.push({ experience: exp, reason: 'tried too short (< 30 chars)' });
      continue;
    }
    
    // Check for generic/boilerplate content in learned
    const genericPhrases = [
      'it worked as expected',
      'the solution was straightforward',
      'always follow best practices',
      'this is a common issue',
      'can significantly',
      'can help with',
      'is important for',
      'should be considered',
      'it is recommended',
      'use automation',
      'helps with maintainability',
      'improves efficiency',
      'reduces errors',
      'ensure proper configuration',
    ];
    const learnedLower = exp.learned.toLowerCase();
    if (genericPhrases.some(p => learnedLower.includes(p))) {
      rejected.push({ experience: exp, reason: `learned contains generic phrase` });
      continue;
    }
    
    // v2: Check tags are English-only (no CJK characters)
    const cjkTags = exp.tags.filter(t => CJK_REGEX.test(t));
    if (cjkTags.length > 0) {
      // Auto-fix: remove CJK tags instead of rejecting entirely
      exp.tags = exp.tags.filter(t => !CJK_REGEX.test(t));
    }
    
    // Check for minimum tags (after CJK removal)
    if (exp.tags.length < 2) {
      rejected.push({ experience: exp, reason: 'too few English tags (< 2 after CJK removal)' });
      continue;
    }
    
    // v2: Check learned has specificity (contains at least one concrete detail)
    // Concrete detail indicators: file paths, commands, error codes, numbers, specific tool names
    const specificityIndicators = /[\/.\\]|`[^`]+`|\d{2,}|--[a-z]|\berror\b|\bbug\b|\bfix\b|\bparam|\bconfig|\bfield|\bcolumn|\btable\b|\bapi\b|\bendpoint/i;
    if (!specificityIndicators.test(exp.learned)) {
      rejected.push({ experience: exp, reason: 'learned lacks specific/actionable detail' });
      continue;
    }
    
    // v2: Confidence floor raised to 0.7
    if (exp.confidence < 0.7) {
      rejected.push({ experience: exp, reason: `confidence ${exp.confidence} < 0.7 threshold` });
      continue;
    }
    
    valid.push(exp);
  }
  
  return { valid, rejected };
}
