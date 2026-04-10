/**
 * Test session classifier against known sessions
 * Run: npx tsx test-classifier.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { classifySession } from './extract.js';

const testCases = [
  {
    name: '数据丢失调查修复 (main agent, original work)',
    file: path.join(process.env.HOME || '', '.openclaw/agents/main/sessions/cdc4289a-2f34-43bb-a110-82a2476470b9.jsonl'),
    agentName: 'main',
    expectedType: 'original',
  },
  {
    name: '失败经验高亮功能 (main agent, original work)',
    file: path.join(process.env.HOME || '', '.openclaw/agents/main/sessions/a36e942f-cc30-4b4a-afa3-8853e6e28bba.jsonl'),
    agentName: 'main',
    expectedType: 'original',
  },
  {
    name: 'Harvester Docker采集 (harvester agent)',
    file: path.join(process.env.HOME || '', '.openclaw/agents/harvester/sessions/5858ddd7-5d34-4d1c-8ba1-b785bb95b46f.jsonl'),
    agentName: 'harvester',
    expectedType: 'harvester',
  },
];

// Find some heartbeat sessions for routine testing
const heartbeatDir = path.join(process.env.HOME || '', '.openclaw/agents/heartbeat/sessions/');
if (fs.existsSync(heartbeatDir)) {
  const hbFiles = fs.readdirSync(heartbeatDir).filter(f => f.endsWith('.jsonl')).slice(0, 2);
  for (const f of hbFiles) {
    testCases.push({
      name: `Heartbeat session ${f.slice(0, 8)}`,
      file: path.join(heartbeatDir, f),
      agentName: 'heartbeat',
      expectedType: 'routine',
    });
  }
}

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  if (!fs.existsSync(tc.file)) {
    console.log(`⏭️  SKIP: ${tc.name} (file not found)`);
    continue;
  }

  const content = fs.readFileSync(tc.file, 'utf-8');
  const result = classifySession(content, tc.agentName);
  
  const ok = result.type === tc.expectedType;
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${tc.name}`);
  console.log(`   Expected: ${tc.expectedType}, Got: ${result.type}`);
  console.log(`   Reason: ${result.reason}`);
  
  if (ok) passed++;
  else failed++;
}

console.log(`\n📊 ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
