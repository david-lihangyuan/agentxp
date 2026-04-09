/**
 * Unit tests for lib/api.js
 * Run: node test/api.test.js
 */

const {
  buildSearchPayload,
  buildPublishPayload,
  parseSearchResponse,
  parseProfileResponse,
  parseStatsResponse,
  getOutcomeBadge,
} = require('../lib/api');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    console.error(`  ✗ ${message} (expected throw, got nothing)`);
    failed++;
  } catch (e) {
    console.log(`  ✓ ${message} (threw: ${e.message})`);
    passed++;
  }
}

// ─── buildSearchPayload ───────────────────────────────────────────────
console.log('\n📦 buildSearchPayload');

const sp = buildSearchPayload('heartbeat config');
assert(sp.query === 'heartbeat config', 'sets query');
assert(sp.channels.precision === true, 'enables precision channel');
assert(sp.channels.serendipity === true, 'enables serendipity channel');

const spWithOpts = buildSearchPayload('test', { tags: ['openclaw'], limit: 5 });
assert(Array.isArray(spWithOpts.tags), 'passes tags');
assert(spWithOpts.limit === 5, 'passes limit');

assertThrows(() => buildSearchPayload(''), 'throws on empty query');
assertThrows(() => buildSearchPayload(null), 'throws on null query');
assertThrows(() => buildSearchPayload(123), 'throws on non-string query');

// ─── buildPublishPayload ──────────────────────────────────────────────
console.log('\n📦 buildPublishPayload');

const pp = buildPublishPayload({
  what: 'Test experience title',
  tried: 'Tried doing X which required configuring Y and Z properly',
  learned: 'Learned that you must set the flag to true before initialization',
});
assert(pp.experience.core.what === 'Test experience title', 'sets what');
assert(pp.experience.core.outcome === 'succeeded', 'defaults outcome to succeeded');
assert(pp.experience.version === 'serendip-experience/0.1', 'sets version');
assert(Array.isArray(pp.experience.tags), 'has tags array');

assertThrows(() => buildPublishPayload({ what: '', tried: 'x'.repeat(20), learned: 'x'.repeat(20) }), 'throws on empty what');
assertThrows(() => buildPublishPayload({ what: 'x'.repeat(101), tried: 'x'.repeat(20), learned: 'x'.repeat(20) }), 'throws on what > 100 chars');
assertThrows(() => buildPublishPayload({ what: 'ok', tried: 'short', learned: 'x'.repeat(20) }), 'throws on tried < 20 chars');
assertThrows(() => buildPublishPayload({ what: 'ok', tried: 'x'.repeat(20), learned: 'short' }), 'throws on learned < 20 chars');
assertThrows(() => buildPublishPayload({ what: 'ok', tried: 'x'.repeat(20), learned: 'x'.repeat(20), outcome: 'invalid' }), 'throws on invalid outcome');

const ppFailed = buildPublishPayload({ what: 'test', tried: 'x'.repeat(20), learned: 'x'.repeat(20), outcome: 'failed' });
assert(ppFailed.experience.core.outcome === 'failed', 'accepts failed outcome');

// ─── parseSearchResponse ──────────────────────────────────────────────
console.log('\n📦 parseSearchResponse');

const mockSearchResp = JSON.stringify({
  precision: [{ experience_id: 'abc', experience: { core: { what: 'test' } } }],
  serendipity: [],
  total_available: 10,
});
const parsed = parseSearchResponse(mockSearchResp);
assert(parsed.precision.length === 1, 'parses precision array');
assert(parsed.serendipity.length === 0, 'parses empty serendipity');
assert(parsed.total === 10, 'parses total_available');

const emptyResp = parseSearchResponse(JSON.stringify({ precision: [], serendipity: [] }));
assert(emptyResp.precision.length === 0, 'handles empty results');
assert(emptyResp.total === 0, 'total defaults to 0');

assertThrows(() => parseSearchResponse(JSON.stringify({ error: 'invalid key' })), 'throws on API error');
assertThrows(() => parseSearchResponse('not json{{{'), 'throws on invalid JSON');

// ─── parseProfileResponse ─────────────────────────────────────────────
console.log('\n📦 parseProfileResponse');

const mockProfile = JSON.stringify({
  agent_id: 'erxia-openclaw',
  tier: 'contributor',
  tier_label: '🌱 贡献者',
  stats: { experiences_published: 8 },
  quota: { daily_limit: 130, remaining: 128 },
  next_tier: { tier: 'verified', needs_verified: 5 },
});
const profile = parseProfileResponse(mockProfile);
assert(profile.agent_id === 'erxia-openclaw', 'parses agent_id');
assert(profile.tier === 'contributor', 'parses tier');
assert(profile.stats.experiences_published === 8, 'parses stats');
assert(profile.quota.remaining === 128, 'parses quota');
assert(profile.next_tier.needs_verified === 5, 'parses next_tier');

assertThrows(() => parseProfileResponse(JSON.stringify({ error: 'unauthorized' })), 'throws on API error');

// ─── parseStatsResponse ───────────────────────────────────────────────
console.log('\n📦 parseStatsResponse');

const mockStats = JSON.stringify({
  totals: { experiences: 65, agents: 22 },
  quality: { outcome_breakdown: { succeeded: 39, failed: 15 } },
  trust: { confirmation_rate: 0.92 },
  diversity: { top_agents: [{ agent_id: 'erxia-openclaw', experience_count: 8 }] },
  tags: { top_tags: [{ tag: 'openclaw', count: 17 }] },
});
const stats = parseStatsResponse(mockStats);
assert(stats.totals.experiences === 65, 'parses totals');
assert(stats.quality.outcome_breakdown.succeeded === 39, 'parses quality');
assert(stats.diversity.top_agents[0].agent_id === 'erxia-openclaw', 'parses top agents');

// ─── getOutcomeBadge ──────────────────────────────────────────────────
console.log('\n📦 getOutcomeBadge');

assert(getOutcomeBadge('succeeded').color === '#10b981', 'succeeded = green');
assert(getOutcomeBadge('failed').color === '#ef4444', 'failed = red');
assert(getOutcomeBadge('partial').color === '#f59e0b', 'partial = yellow');
assert(getOutcomeBadge('unknown_val').label === 'unknown_val', 'unknown falls back to value');

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`总计: ${passed + failed} 个测试`);
console.log(`✓ 通过: ${passed}`);
if (failed > 0) {
  console.error(`✗ 失败: ${failed}`);
  process.exit(1);
} else {
  console.log('🎉 全部通过！');
}
