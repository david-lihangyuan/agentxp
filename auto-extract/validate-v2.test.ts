/**
 * Tests for v2 validation rules:
 * - CJK tag auto-removal
 * - Specificity check in learned
 * - Generic phrase detection (expanded)
 * - Confidence floor 0.7
 */

import { validateExperiences } from './extract';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

function makeExp(overrides: Record<string, any> = {}) {
  return {
    what: 'Test experience',
    context: 'Test context with enough detail',
    tried: 'Tried multiple approaches including checking config files and restarting services',
    outcome: 'succeeded' as const,
    outcome_detail: 'The fix resolved the issue completely',
    learned: 'The --exclude flag in rsync prevents overwriting the data/ directory during deployment',
    tags: ['deployment', 'rsync', 'sqlite'],
    confidence: 0.85,
    ...overrides,
  };
}

// --- Test Suite ---

console.log('\n=== v2 Validation Tests ===\n');

// 1. CJK tags auto-removed
console.log('--- CJK tag handling ---');
{
  const exp = makeExp({ tags: ['docker', '部署', 'sqlite', 'ネットワーク', 'backup'] });
  const { valid } = validateExperiences([exp]);
  assert(valid.length === 1, 'Experience with CJK tags still passes');
  assert(!valid[0].tags.includes('部署'), 'CJK tag "部署" removed');
  assert(!valid[0].tags.includes('ネットワーク'), 'CJK tag "ネットワーク" removed');
  assert(valid[0].tags.includes('docker'), 'English tag "docker" kept');
  assert(valid[0].tags.length === 3, `3 English tags remain (got ${valid[0].tags.length})`);
}

// 2. All CJK tags → rejected (< 2 English tags)
{
  const exp = makeExp({ tags: ['部署', '数据库'] });
  const { valid, rejected } = validateExperiences([exp]);
  assert(valid.length === 0, 'All-CJK tags → rejected');
  assert(rejected[0]?.reason.includes('too few English tags'), 'Correct rejection reason');
}

// 3. Generic phrases in learned
console.log('\n--- Generic phrase detection ---');
{
  const genericTests = [
    'Automation can significantly reduce deployment errors in production environments',
    'Using proper tools can help with debugging and monitoring',
    'Security is important for production deployments and API endpoints',
    'It is recommended to use environment variables for configuration management',
  ];
  for (const learned of genericTests) {
    const exp = makeExp({ learned });
    const { valid, rejected } = validateExperiences([exp]);
    assert(valid.length === 0, `Generic: "${learned.slice(0, 50)}..." rejected`);
  }
}

// 4. Specificity check
console.log('\n--- Specificity in learned ---');
{
  const exp = makeExp({
    learned: 'Writing good code and testing thoroughly prevents many issues in the long run',
  });
  const { valid } = validateExperiences([exp]);
  assert(valid.length === 0, 'Vague learned without specifics → rejected');
}
{
  const exp = makeExp({
    learned: 'The rsync --exclude data/ flag prevents overwriting production SQLite database',
  });
  const { valid } = validateExperiences([exp]);
  assert(valid.length === 1, 'Specific learned with command detail → accepted');
}

// 5. Confidence floor
console.log('\n--- Confidence floor ---');
{
  const exp = makeExp({ confidence: 0.65 });
  const { valid, rejected } = validateExperiences([exp]);
  assert(valid.length === 0, 'Confidence 0.65 → rejected');
  assert(rejected[0]?.reason.includes('0.7'), 'Rejection mentions 0.7 threshold');
}
{
  const exp = makeExp({ confidence: 0.7 });
  const { valid } = validateExperiences([exp]);
  assert(valid.length === 1, 'Confidence 0.7 → accepted');
}

// 6. Learned minimum length raised to 50
console.log('\n--- Learned length ---');
{
  const exp = makeExp({ learned: 'Use rsync for deploy.' });
  const { valid, rejected } = validateExperiences([exp]);
  assert(valid.length === 0, 'Short learned (< 50 chars) → rejected');
  assert(rejected[0]?.reason.includes('50'), 'Mentions 50 char minimum');
}

// 7. Good experience passes all checks
console.log('\n--- Happy path ---');
{
  const exp = makeExp({
    learned: 'OpenAI text-embedding-3-small returns variable dimensions. Always pass explicit dimensions:1536 parameter. vec0 cosine_similarity silently returns 0 on mismatch instead of erroring.',
    tags: ['openai', 'embedding', 'sqlite-vec'],
    confidence: 0.92,
  });
  const { valid, rejected } = validateExperiences([exp]);
  assert(valid.length === 1, 'High-quality experience passes all v2 checks');
  assert(rejected.length === 0, 'No rejections');
}

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
