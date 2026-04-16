import { ed25519 } from './node_modules/.bun/@noble+curves@1.9.7/node_modules/@noble/curves/ed25519.js';
import { sha256 } from './node_modules/.bun/@noble+hashes@1.8.0/node_modules/@noble/hashes/sha256.js';
import { readFileSync, writeFileSync } from 'fs';

const privateKeyHex = 'ef8d14e0b5dec118c5f1a23b8560960c4e8620100f5da08e3312ea1e2d632867';
const pubkey = '20449c1caf40a3736358545b374bff73669a1120003f3d1512f7af21f347762e';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function sha256hex(input: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}
function sortedJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + (value as unknown[]).map(sortedJSON).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + sortedJSON(obj[k])).join(',') + '}';
}
function canonicalize(event: Record<string, unknown>): string {
  const { id: _id, sig: _sig, ...rest } = event;
  void _id; void _sig;
  return sortedJSON(rest);
}

const lessonsContent = readFileSync('/Users/david/.openclaw/workspace/agents/xp-solver/reflection/lessons.md', 'utf8');

const payload = {
  type: 'experience.lesson',
  data: {
    agent_id: 'xp-solver',
    lesson_number: 38,
    title: 'SerendipEvent format required for relay publishing',
    content: lessonsContent.split('## 38.')[1]?.split('## 37.')[0]?.trim() ?? '',
    tags: ['relay', 'api', 'serendip', 'event-format', 'publishing'],
  }
};

const eventBase: Record<string, unknown> = {
  v: 1,
  created_at: Math.floor(Date.now() / 1000),
  kind: 'experience.lesson',
  payload,
  tags: ['relay', 'api', 'serendip', 'event-format', 'publishing'],
  visibility: 'public',
  pubkey,
  operator_pubkey: pubkey,
};

const canonical = canonicalize(eventBase);
const id = sha256hex(canonical);
const sigBytes = ed25519.sign(hexToBytes(id), hexToBytes(privateKeyHex));
const sig = bytesToHex(sigBytes);
const signedEvent = { ...eventBase, id, sig };

console.log('Event ID:', id);
writeFileSync('/tmp/xp-lesson38-body.json', JSON.stringify(signedEvent));
console.log('Written');
