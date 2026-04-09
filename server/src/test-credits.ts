/**
 * 积分系统测试
 */

import { initDB, getClient, insertExperience, insertVerification } from './db.js';
import { initEmbedding } from './embedding.js';
import {
  getCredits,
  adjustCredits,
  hasEnoughCredits,
  awardSearchHitCredits,
  awardVerificationCredits,
  getCreditLedger,
  applyDecay,
  INITIAL_CREDITS,
  CREDIT_RULES,
} from './credits.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}${detail ? `（${detail}）` : ''}`);
    failed++;
  }
}

async function setup() {
  // 用内存数据库
  await initDB('file::memory:');
  initEmbedding('mock', undefined, true);

  const db = getClient();

  // 创建测试用户
  const now = new Date().toISOString();
  await db.execute({
    sql: 'INSERT INTO users (id, agent_id, name, created_at, credits, credits_updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: ['user-alice', 'alice', 'Alice', now, INITIAL_CREDITS, now],
  });
  await db.execute({
    sql: 'INSERT INTO users (id, agent_id, name, created_at, credits, credits_updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: ['user-bob', 'bob', 'Bob', now, INITIAL_CREDITS, now],
  });
  await db.execute({
    sql: 'INSERT INTO users (id, agent_id, name, created_at, credits, credits_updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: ['user-charlie', 'charlie', 'Charlie', now, INITIAL_CREDITS, now],
  });

  // 创建 API keys（用于兼容现有逻辑）
  await db.execute({
    sql: 'INSERT INTO api_keys (key, agent_id, created_at) VALUES (?, ?, ?)',
    args: ['key-alice', 'alice', now],
  });
  await db.execute({
    sql: 'INSERT INTO api_keys (key, agent_id, created_at) VALUES (?, ?, ?)',
    args: ['key-bob', 'bob', now],
  });
}

async function testBasicCredits() {
  console.log('\n--- 1. 基础积分操作 ---');

  const credits = await getCredits('alice');
  assert(credits === INITIAL_CREDITS, `初始积分 = ${INITIAL_CREDITS}`, `实际 ${credits}`);

  const newBalance = await adjustCredits('alice', 10, 'test_add');
  assert(newBalance === INITIAL_CREDITS + 10, `加 10 后余额 = ${INITIAL_CREDITS + 10}`, `实际 ${newBalance}`);

  const afterDeduct = await adjustCredits('alice', -5, 'test_deduct');
  assert(afterDeduct === INITIAL_CREDITS + 5, `扣 5 后余额 = ${INITIAL_CREDITS + 5}`, `实际 ${afterDeduct}`);

  const enough = await hasEnoughCredits('alice', 10);
  assert(enough === true, '有足够积分（35 >= 10）');

  const notEnough = await hasEnoughCredits('alice', 100);
  assert(notEnough === false, '积分不足（35 < 100）');

  // 不存在的用户
  const unknown = await getCredits('nonexistent');
  assert(unknown === 0, '不存在用户积分 = 0');
}

async function testSearchHitCredits() {
  console.log('\n--- 2. 搜索命中积分 ---');

  // 发布经验
  const expId = await insertExperience({
    id: 'exp-credit-1',
    version: 'serendip-experience/0.1',
    published_at: new Date().toISOString(),
    publisher: { agent_id: 'bob', platform: 'test' },
    core: {
      what: '积分测试经验',
      context: '测试',
      tried: '这是一段较长的尝试描述用于测试',
      outcome: 'succeeded',
      outcome_detail: '',
      learned: '这是一段较长的学习描述用于测试',
    },
    tags: ['test'],
  }, null);

  const bobBefore = await getCredits('bob');

  // 搜索命中一次
  await awardSearchHitCredits([expId]);

  const bobAfter = await getCredits('bob');
  assert(
    bobAfter === bobBefore + CREDIT_RULES.search_hit,
    `搜索命中 +${CREDIT_RULES.search_hit}`,
    `之前 ${bobBefore}，之后 ${bobAfter}`,
  );

  // 连续命中到每日上限
  for (let i = 0; i < 10; i++) {
    await awardSearchHitCredits([expId]);
  }

  const bobCapped = await getCredits('bob');
  const maxGain = CREDIT_RULES.search_hit_daily_cap * CREDIT_RULES.search_hit;
  assert(
    bobCapped <= bobBefore + maxGain,
    `每日上限生效（最多 +${maxGain}）`,
    `实际 ${bobCapped - bobBefore}`,
  );
}

async function testVerificationCredits() {
  console.log('\n--- 3. 验证积分 ---');

  // charlie 发布经验
  const expId = await insertExperience({
    id: 'exp-credit-2',
    version: 'serendip-experience/0.1',
    published_at: new Date().toISOString(),
    publisher: { agent_id: 'charlie', platform: 'test' },
    core: {
      what: '验证积分测试',
      context: '测试',
      tried: '这是一段较长的尝试描述用于测试',
      outcome: 'succeeded',
      outcome_detail: '',
      learned: '这是一段较长的学习描述用于测试',
    },
    tags: ['test'],
  }, null);

  const charlieBefore = await getCredits('charlie');

  // alice 确认验证
  await insertVerification(expId, 'alice', 'test', 'confirmed');
  await awardVerificationCredits(expId, 'confirmed');

  const charlieAfterConfirm = await getCredits('charlie');
  assert(
    charlieAfterConfirm === charlieBefore + CREDIT_RULES.verification_confirmed,
    `confirmed 验证 +${CREDIT_RULES.verification_confirmed}`,
    `之前 ${charlieBefore}，之后 ${charlieAfterConfirm}`,
  );

  // bob 否认验证另一条
  const expId2 = await insertExperience({
    id: 'exp-credit-3',
    version: 'serendip-experience/0.1',
    published_at: new Date().toISOString(),
    publisher: { agent_id: 'charlie', platform: 'test' },
    core: {
      what: '被否认的经验',
      context: '测试',
      tried: '这是一段较长的尝试描述用于测试',
      outcome: 'failed',
      outcome_detail: '',
      learned: '这是一段较长的学习描述用于测试',
    },
    tags: ['test'],
  }, null);

  await insertVerification(expId2, 'bob', 'test', 'denied');
  const charlieBeforeDeny = await getCredits('charlie');
  await awardVerificationCredits(expId2, 'denied');

  const charlieAfterDeny = await getCredits('charlie');
  assert(
    charlieAfterDeny === charlieBeforeDeny + CREDIT_RULES.verification_denied,
    `denied 验证 ${CREDIT_RULES.verification_denied}`,
    `之前 ${charlieBeforeDeny}，之后 ${charlieAfterDeny}`,
  );

  // conditional 不加减分
  const charlieBeforeCond = await getCredits('charlie');
  await awardVerificationCredits(expId, 'conditional');
  const charlieAfterCond = await getCredits('charlie');
  assert(
    charlieAfterCond === charlieBeforeCond,
    'conditional 验证不影响积分',
  );
}

async function testCreditLedger() {
  console.log('\n--- 4. 积分明细 ---');

  const ledger = await getCreditLedger('alice', 10);
  assert(ledger.length >= 1, `alice 有积分记录（${ledger.length} 条）`);

  const firstEntry = ledger[0];
  assert(firstEntry.reason !== undefined, '记录有 reason 字段');
  assert(firstEntry.created_at !== undefined, '记录有 created_at 字段');
  assert(typeof firstEntry.amount === 'number', '记录有 amount 字段');

  // bob 的记录包含搜索命中
  const bobLedger = await getCreditLedger('bob', 20);
  const searchHits = bobLedger.filter(e => e.reason === 'search_hit');
  assert(searchHits.length > 0, `bob 有搜索命中积分记录（${searchHits.length} 条）`);
}

async function testDecay() {
  console.log('\n--- 5. 积分衰减 ---');

  const db = getClient();

  // 创建一个 200 天前更新的用户
  const oldDate = new Date(Date.now() - 200 * 86400000).toISOString();
  await db.execute({
    sql: 'INSERT INTO users (id, agent_id, name, created_at, credits, credits_updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: ['user-old', 'old-agent', 'Old', oldDate, 100, oldDate],
  });

  const { affected, details } = await applyDecay();
  assert(affected >= 1, `衰减影响 >= 1 个用户（实际 ${affected}）`);
  assert(details.length >= 1, `衰减详情有记录`);

  const oldCredits = await getCredits('old-agent');
  assert(oldCredits < 100, `200 天不活跃后积分衰减（100 → ${oldCredits}）`);
  assert(oldCredits > 0, `衰减后积分 > 0`);

  // 刚活跃的用户不衰减
  const aliceBefore = await getCredits('alice');
  const { affected: affected2 } = await applyDecay();
  const aliceAfter = await getCredits('alice');
  assert(aliceAfter >= aliceBefore, `活跃用户不衰减（${aliceBefore} → ${aliceAfter}）`);
}

async function testEdgeCases() {
  console.log('\n--- 6. 边界情况 ---');

  // 积分可以扣到负数（业务层决定是否拒绝）
  await adjustCredits('alice', -9999, 'test_overdraft');
  const negative = await getCredits('alice');
  assert(negative < 0, `积分可以为负（${negative}）`);

  // 搜索命中不存在的经验不报错
  let noError = true;
  try {
    await awardSearchHitCredits(['nonexistent-exp-id']);
  } catch {
    noError = false;
  }
  assert(noError, '不存在的经验不报错');

  // 验证不存在的经验不报错
  noError = true;
  try {
    await awardVerificationCredits('nonexistent-exp-id', 'confirmed');
  } catch {
    noError = false;
  }
  assert(noError, '不存在经验的验证不报错');

  // 空数组搜索命中不报错
  noError = true;
  try {
    await awardSearchHitCredits([]);
  } catch {
    noError = false;
  }
  assert(noError, '空搜索命中数组不报错');
}

// === 运行 ===

async function main() {
  console.log('🧪 积分系统测试\n');

  await setup();

  await testBasicCredits();
  await testSearchHitCredits();
  await testVerificationCredits();
  await testCreditLedger();
  await testDecay();
  await testEdgeCases();

  console.log(`\n${'='.repeat(40)}`);
  console.log(`🏁 积分系统测试: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(40));

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
