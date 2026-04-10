/**
 * Phase 3.1 Extraction Quality Test
 * 
 * Tests parseTranscript, formatTranscript, and validateExperiences locally.
 * LLM extraction test requires OPENAI_API_KEY.
 */

import { parseTranscript, formatTranscript, validateExperiences } from './extract';
import * as fs from 'fs';
import * as path from 'path';

let assertions = 0;

function assert(condition: boolean, msg: string) {
  assertions++;
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✅ ${msg}`);
}

// === Test 1: parseTranscript ===
console.log('\n=== Test 1: parseTranscript ===');

// Create a minimal JSONL for testing
const testJsonl = [
  JSON.stringify({ type: 'session', version: 1, id: 'test', timestamp: '2026-04-10T00:00:00Z', cwd: '/tmp' }),
  JSON.stringify({
    type: 'message',
    id: 'msg1',
    timestamp: '2026-04-10T00:01:00Z',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Fix the deployment script that overwrites data files' }]
    }
  }),
  JSON.stringify({
    type: 'message',
    id: 'msg2',
    timestamp: '2026-04-10T00:02:00Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I found the issue — scp is copying the entire directory including data/' },
        { type: 'tool_use', name: 'exec', input: { command: 'ssh root@server "stat data/experiences.db"' }, id: 'tool1' },
      ]
    }
  }),
  JSON.stringify({
    type: 'message',
    id: 'msg3',
    timestamp: '2026-04-10T00:03:00Z',
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tool1', content: [{ type: 'text', text: 'Birth time: 2026-04-10 01:22:52 UTC' }] }
      ]
    }
  }),
  JSON.stringify({
    type: 'message',
    id: 'msg4',
    timestamp: '2026-04-10T00:04:00Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'The database was recreated at that time. Creating deploy.sh to prevent this.' },
        { type: 'tool_use', name: 'write', input: { path: '/opt/agentxp/deploy.sh', content: '#!/bin/bash\nrsync ...' }, id: 'tool2' },
      ]
    }
  }),
].join('\n');

const messages = parseTranscript(testJsonl);
assert(messages.length >= 3, `Parsed ${messages.length} messages (expected >= 3)`);
assert(messages[0].role === 'user', 'First message is from user');
assert(messages[1].content.includes('scp'), 'Second message mentions scp');
assert(messages[1].content.includes('[EXEC]'), 'Tool calls are formatted as [EXEC]');

// === Test 2: formatTranscript ===
console.log('\n=== Test 2: formatTranscript ===');

const formatted = formatTranscript(messages);
assert(formatted.includes('>>> USER:'), 'Formatted transcript has USER prefix');
assert(formatted.includes('>>> ASSISTANT:'), 'Formatted transcript has ASSISTANT prefix');
assert(formatted.length < 5000, `Formatted length ${formatted.length} < 5000`);

// Test truncation
const longFormatted = formatTranscript(messages, 100);
assert(longFormatted.includes('[... transcript truncated ...]') || longFormatted.length <= 200,
  'Truncation works within maxChars');

// === Test 3: validateExperiences ===
console.log('\n=== Test 3: validateExperiences ===');

const { valid, rejected } = validateExperiences([
  {
    what: 'scp deployment overwrote production database',
    context: 'AgentXP production server with SQLite database',
    tried: 'Investigated via SSH: checked DB Birth time, PM2 logs showing count drop 122→35',
    outcome: 'succeeded',
    outcome_detail: 'Created deploy.sh that only copies code files, excludes data/',
    learned: 'Manual scp deployment easily overwrites data files. Always use a deployment script that explicitly excludes data directories. SQLite production DBs need independent backup (cron + sqlite3 .backup).',
    tags: ['deployment', 'sqlite', 'data-loss', 'backup'],
    confidence: 0.95,
  },
  {
    what: 'Too short learned',
    context: 'Test',
    tried: 'Something was tried here',
    outcome: 'succeeded',
    outcome_detail: 'It worked',
    learned: 'It worked fine.',  // Too short
    tags: ['test'],
    confidence: 0.8,
  },
  {
    what: 'Generic learned',
    context: 'Test context for generic experience',
    tried: 'Various approaches were attempted',
    outcome: 'succeeded',
    outcome_detail: 'Solution was found',
    learned: 'Always follow best practices when deploying applications',  // Generic
    tags: ['deployment', 'best-practices'],
    confidence: 0.7,
  },
]);

assert(valid.length === 1, `1 valid experience (got ${valid.length})`);
assert(rejected.length === 2, `2 rejected experiences (got ${rejected.length})`);
assert(rejected[0].reason.includes('learned too short'), 'Rejected for short learned');
assert(rejected[1].reason.includes('generic boilerplate'), 'Rejected for generic content');

// === Test 4: Parse real transcript (if available) ===
console.log('\n=== Test 4: Real transcript parsing ===');

const realSessionPath = path.join(
  process.env.HOME || '',
  '.openclaw/agents/main/sessions/cdc4289a-2f34-43bb-a110-82a2476470b9.jsonl'
);

if (fs.existsSync(realSessionPath)) {
  const realContent = fs.readFileSync(realSessionPath, 'utf-8');
  const realMessages = parseTranscript(realContent);
  assert(realMessages.length > 5, `Real transcript has ${realMessages.length} messages (> 5)`);
  
  const realFormatted = formatTranscript(realMessages);
  assert(realFormatted.length > 1000, `Real formatted transcript is ${realFormatted.length} chars (> 1000)`);
  assert(realFormatted.includes('>>> ASSISTANT:'), 'Real transcript has assistant messages');
  
  console.log(`  📊 Real transcript: ${realMessages.length} messages, ${realFormatted.length} chars formatted`);
  
  // Check it mentions data-loss related content
  const mentionsDataLoss = realFormatted.toLowerCase().includes('数据') || 
                           realFormatted.toLowerCase().includes('data') ||
                           realFormatted.toLowerCase().includes('丢失');
  assert(mentionsDataLoss, 'Real transcript mentions data/丢失 (expected for this session)');
} else {
  console.log('  ⏭️ Skipping (real session file not found)');
}

// === Test 5: System prompt length check ===
console.log('\n=== Test 5: System prompt efficiency ===');

// The system prompt should be under 2000 tokens (~8000 chars)
// We don't have the actual constant here but we can check the file
const extractModule = fs.readFileSync(path.join(__dirname, '..', 'extract.ts'), 'utf-8');
const promptMatch = extractModule.match(/EXTRACTION_SYSTEM_PROMPT\s*=\s*`([\s\S]*?)`;/);
if (promptMatch) {
  const promptLength = promptMatch[1].length;
  assert(promptLength < 4000, `System prompt is ${promptLength} chars (< 4000 target for ~1000 tokens)`);
  console.log(`  📊 System prompt: ${promptLength} chars`);
}

// === Summary ===
console.log(`\n✅ All ${assertions} assertions passed`);
