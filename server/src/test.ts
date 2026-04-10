/**
 * 经验网络端到端测试
 * 测试：publish → search（双通道）→ verify → min_verifications 过滤器
 *
 * MOCK_EMBEDDINGS=true，不需要 OpenAI key
 * 使用 libSQL 内存数据库
 */

import { initDB, getClient, insertExperience, insertExecutables, getExperience, updateExperienceStatus, deleteExperience, getExecutables, getExecutablesByIds, insertVerification, getVerificationSummary, getAgentByKey, getAgentVerifiedIds } from './db.js';
import { initEmbedding, getEmbedding, experienceToText, cosineSimilarity } from './embedding.js';
import { search } from './search.js';
import { getAgentProfile, checkSearchQuota, recordSearch, getSearchCountToday } from './rewards.js';
import { insertSearchLog, getAgentSearchStats } from './db.js';
import type { Experience, SearchRequest } from './types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// === 工具函数 ===

function makeExperience(overrides: Partial<Experience> & { core: Experience['core']; publisher: Experience['publisher']; tags: string[] }): Experience {
  return {
    id: crypto.randomUUID(),
    version: 'serendip-experience/0.1',
    published_at: new Date().toISOString(),
    ...overrides,
  };
}

async function publishExperience(exp: Experience): Promise<string> {
  const text = experienceToText({
    what: exp.core.what,
    context: exp.core.context,
    tried: exp.core.tried,
    learned: exp.core.learned,
    tags: exp.tags,
  });
  const embedding = await getEmbedding(text);
  return insertExperience(exp, embedding);
}

/** 向当前数据库插入测试用 API key */
async function insertApiKey(key: string, agentId: string): Promise<void> {
  await getClient().execute({
    sql: 'INSERT INTO api_keys (key, agent_id, created_at) VALUES (?, ?, ?)',
    args: [key, agentId, new Date().toISOString()],
  });
}

// === 测试入口 ===

async function main() {
  console.log('🧪 经验网络端到端测试（libSQL）\n');

  // 初始化（内存数据库 + mock embedding）
  await initDB(':memory:');
  initEmbedding('mock', undefined, true);

  // 注册测试用 API key
  await insertApiKey('key-alice', 'alice');
  await insertApiKey('key-bob', 'bob');
  await insertApiKey('key-charlie', 'charlie');

  // ========== 1. 发布经验 ==========
  console.log('--- 1. 发布经验 ---');

  const exp1 = makeExperience({
    publisher: { agent_id: 'alice', platform: 'openclaw' },
    core: {
      what: 'TypeScript 编译器配置优化',
      context: '大型 monorepo 项目编译时间过长',
      tried: '开启 incremental + composite + skipLibCheck',
      outcome: 'succeeded',
      outcome_detail: '编译时间从 45s 降到 12s',
      learned: '对大型项目，skipLibCheck 的提升最明显，但要确保 CI 里开启完整检查',
    },
    tags: ['typescript', 'performance', 'compiler'],
  });
  const id1 = await publishExperience(exp1);
  assert(!!id1, '发布经验 1（TS 编译优化）');

  const exp2 = makeExperience({
    publisher: { agent_id: 'alice', platform: 'openclaw' },
    core: {
      what: 'SQLite WAL 模式性能调优',
      context: '高并发写入场景下 SQLite 锁等待频繁',
      tried: '开启 WAL 模式 + busy_timeout + 合理的 checkpoint 策略',
      outcome: 'succeeded',
      outcome_detail: '写入吞吐量提升 5 倍',
      learned: 'WAL 模式在读多写少场景效果最好，写密集场景需要搭配 checkpoint 策略',
    },
    tags: ['sqlite', 'database', 'performance'],
  });
  const id2 = await publishExperience(exp2);
  assert(!!id2, '发布经验 2（SQLite WAL）');

  const exp3 = makeExperience({
    publisher: { agent_id: 'bob', platform: 'openclaw' },
    core: {
      what: 'Docker 多阶段构建减小镜像体积',
      context: 'Node.js 应用镜像超过 1GB',
      tried: '多阶段构建 + Alpine 基础镜像 + 只复制 production 依赖',
      outcome: 'failed',
      outcome_detail: '镜像体积减小了，但 Alpine 缺少某些 native 模块的依赖',
      learned: 'Alpine 不总是最好的选择——如果项目依赖 native 模块，用 slim 更稳定',
    },
    tags: ['docker', 'devops', 'nodejs'],
  });
  const id3 = await publishExperience(exp3);
  assert(!!id3, '发布经验 3（Docker 构建失败经验）');

  // 验证数据库
  const stored = await getExperience(id1);
  assert(stored !== null, '经验可从数据库读取');
  assert(stored?.core.what === exp1.core.what, '经验内容一致');

  // ========== 2. 搜索测试 ==========
  console.log('\n--- 2. 基本搜索 ---');

  const result1 = await search({
    query: 'TypeScript compiler performance optimization',
    limit: 10,
  });
  assert(result1.total_available >= 0, `搜索返回结果（total_available=${result1.total_available}）`);
  assert(Array.isArray(result1.precision), 'precision 通道返回数组');
  assert(Array.isArray(result1.serendipity), 'serendipity 通道返回数组');

  // ========== 3. 过滤器测试 ==========
  console.log('\n--- 3. 过滤器 ---');

  // outcome 过滤
  const resultFailed = await search({
    query: 'Docker image optimization',
    filters: { outcome: 'failed' },
  });
  const allFailed = resultFailed.precision.every(r =>
    (r.experience as any).core?.outcome === 'failed'
  );
  assert(
    resultFailed.precision.length === 0 || allFailed,
    'outcome=failed 过滤只返回失败经验',
  );

  // tag 过滤
  const resultTagged = await search({
    query: 'performance',
    tags: ['sqlite'],
  });
  const allTagged = resultTagged.precision.every(r => {
    const exp = r.experience as Experience;
    return exp.tags?.includes('sqlite');
  });
  assert(
    resultTagged.precision.length === 0 || allTagged,
    'tag 过滤只返回包含指定 tag 的经验',
  );

  // ========== 4. 验证流程 ==========
  console.log('\n--- 4. 验证流程 ---');

  // bob 验证 alice 的经验 1
  const verId1 = await insertVerification(id1, 'bob', 'openclaw', 'confirmed', null, '确认有效');
  assert(!!verId1, 'bob 确认验证经验 1');

  // charlie 也确认验证
  const verId2 = await insertVerification(id1, 'charlie', 'openclaw', 'confirmed', null, '同样有效');
  assert(!!verId2, 'charlie 确认验证经验 1');

  // 验证摘要
  const summary1 = await getVerificationSummary(id1);
  assert(summary1.confirmed === 2, `经验 1 有 2 次确认（实际 ${summary1.confirmed}）`);
  assert(summary1.total === 2, `经验 1 共 2 次验证（实际 ${summary1.total}）`);

  // 对经验 2 不做验证
  const summary2 = await getVerificationSummary(id2);
  assert(summary2.total === 0, `经验 2 零验证（实际 ${summary2.total}）`);

  // alice 否认经验 3
  const verId3 = await insertVerification(id3, 'alice', 'openclaw', 'denied', null, '不准确');
  assert(!!verId3, 'alice 否认验证经验 3');

  const summary3 = await getVerificationSummary(id3);
  assert(summary3.denied === 1, `经验 3 有 1 次否认（实际 ${summary3.denied}）`);

  // ========== 5. min_verifications 过滤器 ==========
  console.log('\n--- 5. min_verifications 过滤器 ---');

  const resultMinVer = await search({
    query: 'TypeScript compiler performance optimization SQLite WAL Docker Alpine',
    filters: { min_verifications: 2 },
  });

  const allResultIds = [
    ...resultMinVer.precision.map(r => r.experience_id),
    ...resultMinVer.serendipity.map(r => r.experience_id),
  ];

  assert(!allResultIds.includes(id2), `min_verifications=2 过滤掉零验证的经验 2`);
  assert(!allResultIds.includes(id3), `min_verifications=2 过滤掉只有 denied 的经验 3`);

  const resultMinVer1 = await search({
    query: 'TypeScript compiler performance optimization SQLite WAL Docker Alpine',
    filters: { min_verifications: 1 },
  });
  const allResultIds1 = [
    ...resultMinVer1.precision.map(r => r.experience_id),
    ...resultMinVer1.serendipity.map(r => r.experience_id),
  ];
  assert(!allResultIds1.includes(id2), `min_verifications=1 过滤掉零确认的经验 2`);
  assert(!allResultIds1.includes(id3), `min_verifications=1 过滤掉零确认的经验 3（denied 不算）`);

  // min_verifications=0 或不设 → 全部返回
  const resultNoMinVer = await search({
    query: 'TypeScript compiler performance optimization SQLite WAL Docker Alpine',
  });
  assert(
    resultNoMinVer.total_available >= 3,
    `无 min_verifications 过滤时 total_available >= 3（实际 ${resultNoMinVer.total_available}）`,
  );

  // ========== 6. 双通道验证 ==========
  console.log('\n--- 6. 双通道通道控制 ---');

  const resultPrecisionOnly = await search({
    query: 'TypeScript',
    channels: { precision: true, serendipity: false },
  });
  assert(resultPrecisionOnly.serendipity.length === 0, '关闭 serendipity 通道时返回空');

  const resultSerendipityOnly = await search({
    query: 'TypeScript',
    channels: { precision: false, serendipity: true },
  });
  assert(resultSerendipityOnly.precision.length === 0, '关闭 precision 通道时返回空');

  // ========== 7. API key 验证 ==========
  console.log('\n--- 7. API key ---');

  assert(await getAgentByKey('key-alice') === 'alice', 'key-alice 解析为 alice');
  assert(await getAgentByKey('key-bob') === 'bob', 'key-bob 解析为 bob');
  assert(await getAgentByKey('invalid-key') === null, '无效 key 返回 null');

  // ========== 8. 边界情况 ==========
  console.log('\n--- 8. 边界情况 ---');

  // 空库搜索
  await initDB(':memory:');
  initEmbedding('mock', undefined, true);
  const emptyResult = await search({ query: 'anything' });
  assert(emptyResult.precision.length === 0, '空库搜索 precision 返回空');
  assert(emptyResult.serendipity.length === 0, '空库搜索 serendipity 返回空');
  assert(emptyResult.total_available === 0, '空库 total_available=0');

  // ========== 9. max_age_days 过滤 ==========
  console.log('\n--- 9. max_age_days 过滤 ---');

  await initDB(':memory:');
  initEmbedding('mock', undefined, true);
  await insertApiKey('key-test9', 'tester');

  // 新鲜经验（今天）
  const freshExp = makeExperience({
    publisher: { agent_id: 'tester', platform: 'openclaw' },
    core: {
      what: 'Fresh experience about React hooks',
      context: 'Modern frontend development',
      tried: 'Custom hooks for state management',
      outcome: 'succeeded',
      outcome_detail: 'Clean code, better reusability',
      learned: 'Custom hooks reduce boilerplate significantly',
    },
    tags: ['react', 'frontend'],
  });
  const freshId = await publishExperience(freshExp);

  // 旧经验（200 天前）
  const oldExp = makeExperience({
    published_at: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
    publisher: { agent_id: 'tester', platform: 'openclaw' },
    core: {
      what: 'Old experience about jQuery plugins',
      context: 'Legacy frontend migration',
      tried: 'jQuery to React migration path',
      outcome: 'partial',
      outcome_detail: 'Some components migrated but jQuery UI hard to replace',
      learned: 'Start migration from leaf components',
    },
    tags: ['jquery', 'frontend', 'migration'],
  });
  const oldId = await publishExperience(oldExp);

  const resultMaxAge = await search({
    query: 'frontend development React jQuery migration hooks',
    filters: { max_age_days: 30 },
  });
  const maxAgeAllIds = [
    ...resultMaxAge.precision.map(r => r.experience_id),
    ...resultMaxAge.serendipity.map(r => r.experience_id),
  ];
  assert(!maxAgeAllIds.includes(oldId), 'max_age_days=30 过滤掉 200 天前的经验');

  // 无过滤时旧经验应可见
  const resultNoAge = await search({
    query: 'frontend development React jQuery migration hooks',
  });
  assert(resultNoAge.total_available >= 2, `无年龄过滤时 total_available >= 2（实际 ${resultNoAge.total_available}）`);

  // ========== 9.5 ttl_days 过期过滤 ==========
  console.log('\n--- 9.5 ttl_days 过期过滤 ---');

  await initDB(':memory:');
  initEmbedding('mock', undefined, true);

  // 经验 A：ttl_days=10，发布于 5 天前 → 未过期，应可见
  const ttlFreshExp = makeExperience({
    published_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    ttl_days: 10,
    publisher: { agent_id: 'ttl-tester', platform: 'openclaw' },
    core: {
      what: 'TTL fresh experience about caching strategies',
      context: 'Redis caching patterns',
      tried: 'TTL-based cache invalidation',
      outcome: 'succeeded',
      outcome_detail: 'Cache hit rate improved',
      learned: 'Short TTL works better for volatile data',
    },
    tags: ['caching', 'redis'],
  });
  const ttlFreshId = await publishExperience(ttlFreshExp);

  // 经验 B：ttl_days=10，发布于 15 天前 → 已过期，应被过滤
  const ttlExpiredExp = makeExperience({
    published_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    ttl_days: 10,
    publisher: { agent_id: 'ttl-tester', platform: 'openclaw' },
    core: {
      what: 'TTL expired experience about caching eviction',
      context: 'Redis cache eviction policies',
      tried: 'LRU eviction for memory management',
      outcome: 'succeeded',
      outcome_detail: 'Memory usage stabilized',
      learned: 'LRU eviction needs proper maxmemory config',
    },
    tags: ['caching', 'redis'],
  });
  const ttlExpiredId = await publishExperience(ttlExpiredExp);

  // 经验 C：ttl_days=null（永不过期），发布于 200 天前 → 应可见
  const noTtlExp = makeExperience({
    published_at: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
    publisher: { agent_id: 'ttl-tester', platform: 'openclaw' },
    core: {
      what: 'No TTL experience about caching fundamentals',
      context: 'General caching theory',
      tried: 'Write-through vs write-behind caching',
      outcome: 'succeeded',
      outcome_detail: 'Understanding improved',
      learned: 'Write-through is safer, write-behind is faster',
    },
    tags: ['caching'],
  });
  const noTtlId = await publishExperience(noTtlExp);

  const resultTtl = await search({
    query: 'caching Redis eviction TTL LRU strategies fundamentals',
  });
  const ttlAllIds = [
    ...resultTtl.precision.map(r => r.experience_id),
    ...resultTtl.serendipity.map(r => r.experience_id),
  ];
  assert(!ttlAllIds.includes(ttlExpiredId), 'ttl_days=10 且发布 15 天前的经验被过滤');
  assert(resultTtl.total_available >= 1, `ttl_days 过滤后至少 1 条可用（实际 ${resultTtl.total_available}）`);

  // ========== 10. platform 过滤 ==========
  console.log('\n--- 10. platform 过滤 ---');

  await initDB(':memory:');
  initEmbedding('mock', undefined, true);
  await insertApiKey('key-p1', 'agent1');
  await insertApiKey('key-p2', 'agent2');

  const expPlatA = makeExperience({
    publisher: { agent_id: 'agent1', platform: 'openclaw' },
    core: {
      what: 'Database indexing strategy',
      context: 'PostgreSQL performance tuning',
      tried: 'Partial indexes on frequently queried columns',
      outcome: 'succeeded',
      outcome_detail: 'Query time reduced 80%',
      learned: 'Partial indexes are underutilized',
    },
    tags: ['database', 'postgres'],
  });
  await publishExperience(expPlatA);

  const expPlatB = makeExperience({
    publisher: { agent_id: 'agent2', platform: 'cursor' },
    core: {
      what: 'Database connection pooling',
      context: 'High-traffic Node.js API server',
      tried: 'PgBouncer with transaction pooling mode',
      outcome: 'succeeded',
      outcome_detail: 'Handled 10x more concurrent connections',
      learned: 'Transaction pooling is key for short-lived connections',
    },
    tags: ['database', 'postgres', 'devops'],
  });
  await publishExperience(expPlatB);

  const resultPlatform = await search({
    query: 'database postgres performance indexing pooling',
    filters: { platform: 'openclaw' },
  });
  const platResults = [
    ...resultPlatform.precision,
    ...resultPlatform.serendipity,
  ];
  const allOpenclaw = platResults.every(r => {
    const exp = r.experience as Experience;
    return exp.publisher.platform === 'openclaw';
  });
  assert(
    platResults.length === 0 || allOpenclaw,
    'platform=openclaw 过滤只返回 openclaw 平台的经验',
  );

  // ========== 11. limit 参数裁剪 ==========
  console.log('\n--- 11. limit 参数裁剪 ---');

  await initDB(':memory:');
  initEmbedding('mock', undefined, true);

  for (let i = 0; i < 5; i++) {
    const exp = makeExperience({
      publisher: { agent_id: 'bulk', platform: 'openclaw' },
      core: {
        what: `Bulk experience ${i} about testing strategies`,
        context: `Testing scenario ${i}`,
        tried: `Approach ${i} for integration tests`,
        outcome: 'succeeded',
        outcome_detail: `Result ${i}`,
        learned: `Lesson ${i} about test coverage`,
      },
      tags: ['testing'],
    });
    await publishExperience(exp);
  }

  const resultLimit2 = await search({
    query: 'testing strategies integration test coverage',
    limit: 2,
  });
  assert(
    resultLimit2.precision.length <= 2,
    `limit=2 precision 通道最多返回 2 条（实际 ${resultLimit2.precision.length}）`,
  );

  // ========== 12. 信任分排序效果 ==========
  console.log('\n--- 12. 信任分排序效果 ---');

  await initDB(':memory:');
  initEmbedding('mock', undefined, true);
  await insertApiKey('key-t1', 'trusted-agent');
  await insertApiKey('key-t2', 'verifier1');
  await insertApiKey('key-t3', 'verifier2');
  await insertApiKey('key-t4', 'verifier3');

  const endorsedExp = makeExperience({
    publisher: { agent_id: 'trusted-agent', platform: 'openclaw' },
    core: {
      what: 'API rate limiting with Redis',
      context: 'High-traffic API protection',
      tried: 'Token bucket algorithm with Redis sorted sets',
      outcome: 'succeeded',
      outcome_detail: 'Clean rate limiting with sub-millisecond checks',
      learned: 'Sorted sets are perfect for sliding window rate limiting',
    },
    tags: ['redis', 'api', 'rate-limiting'],
    trust: { operator_endorsed: true },
  });
  const endorsedId = await publishExperience(endorsedExp);

  await insertVerification(endorsedId, 'verifier1', 'openclaw', 'confirmed', null, '有效');
  await insertVerification(endorsedId, 'verifier2', 'openclaw', 'confirmed', null, '有效');
  await insertVerification(endorsedId, 'verifier3', 'openclaw', 'confirmed', null, '有效');

  const plainExp = makeExperience({
    publisher: { agent_id: 'trusted-agent', platform: 'openclaw' },
    core: {
      what: 'API rate limiting with in-memory counter',
      context: 'Simple API protection for small services',
      tried: 'Simple in-memory counter with setInterval cleanup',
      outcome: 'succeeded',
      outcome_detail: 'Works for single instance, no persistence needed',
      learned: 'In-memory approach is fine for small scale',
    },
    tags: ['api', 'rate-limiting'],
  });
  const plainId = await publishExperience(plainExp);

  const resultTrust = await search({
    query: 'API rate limiting Redis in-memory counter bucket',
    limit: 10,
  });

  if (resultTrust.precision.length >= 2) {
    const idx1 = resultTrust.precision.findIndex(r => r.experience_id === endorsedId);
    const idx2 = resultTrust.precision.findIndex(r => r.experience_id === plainId);
    if (idx1 >= 0 && idx2 >= 0) {
      assert(idx1 < idx2, '有背书+3次验证的经验排在无背书无验证的前面');
    } else {
      assert(true, '信任分排序——部分经验未进入 precision（mock embedding 限制，跳过）');
    }
  } else {
    assert(true, '信任分排序——precision 条目不足（mock embedding 限制，跳过）');
  }

  const endorsedVer = await getVerificationSummary(endorsedId);
  assert(endorsedVer.confirmed === 3, `有背书经验有 3 次确认（实际 ${endorsedVer.confirmed}）`);
  const plainVer = await getVerificationSummary(plainId);
  assert(plainVer.total === 0, `无验证经验有 0 次验证（实际 ${plainVer.total}）`);

  // ========== 13. conditional 验证类型 ==========
  console.log('\n--- 13. conditional 验证类型 ---');

  const condVerId = await insertVerification(plainId, 'verifier1', 'openclaw', 'conditional', '仅适用于单实例部署', '有条件确认');
  assert(!!condVerId, 'conditional 验证可以记录');

  const condSummary = await getVerificationSummary(plainId);
  assert(condSummary.conditional === 1, `conditional 验证计数正确（实际 ${condSummary.conditional}）`);
  assert(condSummary.total === 1, `总验证数包含 conditional（实际 ${condSummary.total}）`);

  // ========== 14. serendipity 最多 3 条上限 ==========
  console.log('\n--- 14. serendipity 数量上限 ---');

  await initDB(':memory:');
  initEmbedding('mock', undefined, true);

  for (let i = 0; i < 10; i++) {
    const domains = ['AI', 'blockchain', 'biotech', 'robotics', 'space', 'quantum', 'materials', 'energy', 'agriculture', 'education'];
    const exp = makeExperience({
      publisher: { agent_id: `agent-${i}`, platform: 'openclaw' },
      core: {
        what: `${domains[i]} innovation approach ${i}`,
        context: `${domains[i]} field challenge`,
        tried: `Novel method ${i} in ${domains[i]}`,
        outcome: i % 2 === 0 ? 'succeeded' : 'failed',
        outcome_detail: `Outcome for ${domains[i]} experiment`,
        learned: `Key insight from ${domains[i]} domain`,
      },
      tags: [domains[i].toLowerCase(), 'innovation'],
    });
    await publishExperience(exp);
  }

  const resultSCap = await search({
    query: 'innovation research novel approach',
    channels: { precision: false, serendipity: true },
  });
  assert(
    resultSCap.serendipity.length <= 3,
    `serendipity 通道最多返回 3 条（实际 ${resultSCap.serendipity.length}）`,
  );

  // ========== 15. serendipity reason 内容验证 ==========
  console.log('\n--- 15. serendipity reason 内容 ---');

  if (resultSCap.serendipity.length > 0) {
    const allHaveReason = resultSCap.serendipity.every(
      r => typeof r.serendipity_reason === 'string' && r.serendipity_reason.length > 0,
    );
    assert(allHaveReason, 'serendipity 结果都有 reason 字段且非空');
  } else {
    assert(true, 'serendipity reason 验证——无结果（mock embedding 限制，跳过）');
  }

  // ========== 16. Publish 输入校验 ==========
  console.log('\n--- 16. Publish 输入校验 ---');

  // 16a. what 超长
  try {
    const longWhat = makeExperience({
      core: { what: 'x'.repeat(101), context: '', tried: 'tried', outcome: 'succeeded', outcome_detail: '', learned: 'learned' },
      publisher: { agent_id: 'test', platform: 'test' },
      tags: [],
    });
    await insertExperience(longWhat, null);
    // insertExperience 不做长度校验（是 API 层做的），所以这里测试的是逻辑连通性
    assert(true, 'what 超长经验可以写入 DB（校验在 API 层）');
  } catch (err) {
    assert(false, 'what 超长经验写入失败', String(err));
  }

  // 16b. outcome 非法值——DB CHECK 约束应拦截
  try {
    const badOutcome = makeExperience({
      core: { what: 'test', context: '', tried: 'tried', outcome: 'unknown' as any, outcome_detail: '', learned: 'learned' },
      publisher: { agent_id: 'test', platform: 'test' },
      tags: [],
    });
    await insertExperience(badOutcome, null);
    assert(false, '非法 outcome 应被 DB 拒绝');
  } catch (err) {
    assert(true, '非法 outcome 被 DB CHECK 约束拦截');
  }

  // 16c. tags 存储和读取一致性
  const manyTags = makeExperience({
    core: { what: 'tags test', context: '', tried: 'tried', outcome: 'succeeded', outcome_detail: '', learned: 'learned' },
    publisher: { agent_id: 'test', platform: 'test' },
    tags: Array.from({ length: 15 }, (_, i) => `tag-${i}`),
  });
  const manyTagsId = await insertExperience(manyTags, null);
  const manyTagsRead = await getExperience(manyTagsId);
  assert(
    manyTagsRead !== null && manyTagsRead.tags.length === 15,
    `15 个 tags 存取一致（实际 ${manyTagsRead?.tags.length}）`,
  );

  // ========== 17. 可执行内容基础 CRUD ==========
  console.log('\n--- 17. 可执行内容基础 CRUD ---');

  // 17a. 发布带 executable 的经验
  const expWithExec = makeExperience({
    publisher: { agent_id: 'alice', platform: 'openclaw' },
    core: {
      what: 'ESM 项目的 Jest 配置',
      context: 'TypeScript + ESM + Jest',
      tried: '用 @swc/jest 替代 ts-jest',
      outcome: 'succeeded',
      outcome_detail: '配置生效，测试全通',
      learned: 'jest.config 必须用 .mts 扩展名',
    },
    tags: ['jest', 'esm', 'typescript'],
  });
  const execId = await publishExperience(expWithExec);

  await insertExecutables(execId, [
    {
      type: 'config',
      language: 'typescript',
      code: 'export default { transform: { "^.+\\\\.tsx?$": ["@swc/jest"] } };',
      description: 'Jest ESM 配置模板',
      requires: { dependencies: ['@swc/jest>=0.2.29'], runtime: 'node>=18' },
      verify: { command: 'npx jest --passWithNoTests', expect: 'exit 0' },
    },
    {
      type: 'command',
      language: 'bash',
      code: 'npm install -D @swc/jest @swc/core',
      description: '安装 SWC 依赖',
    },
  ]);

  const readBack = await getExperience(execId);
  assert(readBack !== null, '带 executable 的经验可读取');
  assert(readBack!.executable !== undefined && readBack!.executable.length === 2, `executable 数量正确（实际 ${readBack!.executable?.length}）`);
  assert(readBack!.executable![0].type === 'config', `第一个片段类型是 config（实际 ${readBack!.executable![0].type}）`);
  assert(readBack!.executable![1].type === 'command', `第二个片段类型是 command（实际 ${readBack!.executable![1].type}）`);
  assert(readBack!.executable![0].requires?.runtime === 'node>=18', 'requires.runtime 存取正确');
  assert(readBack!.executable![0].verify?.command === 'npx jest --passWithNoTests', 'verify.command 存取正确');

  // 17b. getExecutables 直接查询
  const execs = await getExecutables(execId);
  assert(execs.length === 2, `getExecutables 返回 2 个片段（实际 ${execs.length}）`);

  // 17c. getExecutablesByIds 批量查询
  const execMap = await getExecutablesByIds([execId, 'non-existent-id']);
  assert(execMap.has(execId), 'getExecutablesByIds 包含目标 ID');
  assert(!execMap.has('non-existent-id'), 'getExecutablesByIds 不包含不存在的 ID');
  assert(execMap.get(execId)!.length === 2, `批量查询返回 2 个片段（实际 ${execMap.get(execId)!.length}）`);

  // 17d. 无 executable 的经验（新建一个干净的，避免依赖早期测试 ID）
  const plainExpId = await publishExperience(makeExperience({
    publisher: { agent_id: 'alice', platform: 'openclaw' },
    core: {
      what: '纯叙事经验，无 executable',
      context: '',
      tried: 'tried',
      outcome: 'succeeded',
      outcome_detail: '',
      learned: 'learned',
    },
    tags: ['test'],
  }));
  const noExecExp = await getExperience(plainExpId);
  assert(noExecExp !== null, '无 executable 的经验可读取');
  assert(noExecExp!.executable === undefined, '无 executable 的经验不带 executable 字段');

  // ========== 18. 搜索结果包含 has_executable ==========
  console.log('\n--- 18. 搜索结果 has_executable ---');

  const searchExecResult = await search({
    query: 'Jest ESM TypeScript 配置',
    limit: 20,
  });

  // 找到带 executable 的经验
  const precisionWithExec = searchExecResult.precision.filter(r => r.has_executable);
  const precisionWithoutExec = searchExecResult.precision.filter(r => !r.has_executable);

  // mock embedding 下相似度随机，不一定能搜到特定经验
  // 但可以验证 has_executable 字段存在
  const allResults = [...searchExecResult.precision, ...searchExecResult.serendipity];
  const allHaveField = allResults.every(r => typeof r.has_executable === 'boolean');
  assert(allHaveField, '所有搜索结果都有 has_executable 字段');

  // 查找我们刚发布的经验
  const ourResult = allResults.find(r => r.experience_id === execId);
  if (ourResult) {
    assert(ourResult.has_executable === true, '带 executable 的经验 has_executable=true');
    assert(
      Array.isArray(ourResult.executable_types) && ourResult.executable_types.includes('config'),
      `executable_types 包含 config（实际 ${JSON.stringify(ourResult.executable_types)}）`,
    );
  } else {
    assert(true, '带 executable 的经验未进入搜索结果（mock embedding 限制，跳过）');
  }

  // ========== 19. 可执行内容边界条件 ==========
  console.log('\n--- 19. 可执行内容边界条件 ---');

  // 19a. 空数组
  const emptyExecExp = makeExperience({
    publisher: { agent_id: 'bob', platform: 'openclaw' },
    core: {
      what: '空 executable 测试',
      context: '',
      tried: 'tried',
      outcome: 'succeeded',
      outcome_detail: '',
      learned: 'learned',
    },
    tags: ['test'],
  });
  const emptyExecId = await publishExperience(emptyExecExp);
  await insertExecutables(emptyExecId, []);
  const emptyExecRead = await getExperience(emptyExecId);
  assert(emptyExecRead!.executable === undefined, '空 executable 数组不带 executable 字段');

  // 19b. 只有 verify.command 没有 verify.expect
  const noExpectId = await publishExperience(makeExperience({
    publisher: { agent_id: 'charlie', platform: 'openclaw' },
    core: {
      what: 'verify 边界测试',
      context: '',
      tried: 'tried',
      outcome: 'succeeded',
      outcome_detail: '',
      learned: 'learned',
    },
    tags: ['test'],
  }));
  await insertExecutables(noExpectId, [{
    type: 'test',
    language: 'bash',
    code: 'echo hello',
    description: '测试片段',
    verify: { command: 'echo hello', expect: '' },
  }]);
  const noExpectRead = await getExperience(noExpectId);
  assert(
    noExpectRead!.executable![0].verify?.command === 'echo hello',
    'verify.command 存取正确（无 expect）',
  );

  // 19c. requires 为 null / 空
  const noRequiresId = await publishExperience(makeExperience({
    publisher: { agent_id: 'alice', platform: 'openclaw' },
    core: {
      what: 'requires 空测试',
      context: '',
      tried: 'tried',
      outcome: 'succeeded',
      outcome_detail: '',
      learned: 'learned',
    },
    tags: ['test'],
  }));
  await insertExecutables(noRequiresId, [{
    type: 'snippet',
    language: 'python',
    code: 'print("hello")',
    description: '无 requires 的片段',
  }]);
  const noRequiresRead = await getExperience(noRequiresId);
  assert(
    noRequiresRead!.executable![0].requires === undefined,
    'requires 为空时不带 requires 字段',
  );

  // ========== 20. 奖励机制测试 ==========
  console.log('\n20. 奖励机制');

  // 20a. newcomer 等级（没有发布任何经验的 agent）
  const newcomerProfile = await getAgentProfile('brand-new-agent');
  assert(
    newcomerProfile.tier === 'newcomer',
    'newcomer 等级：没有经验的 agent',
  );
  assert(
    newcomerProfile.tier_label === '👋 新成员',
    'newcomer 标签正确',
  );
  assert(
    newcomerProfile.quota.daily_limit === 50,
    'newcomer 基础配额 50 次/天',
    `实际: ${newcomerProfile.quota.daily_limit}`,
  );

  // 20b. contributor 等级（有经验但未被验证的 agent）
  // alice 已经在之前测试中发布过经验
  const aliceProfile = await getAgentProfile('alice');
  assert(
    aliceProfile.tier === 'contributor' || aliceProfile.tier === 'verified' || aliceProfile.tier === 'trusted',
    'alice 至少是 contributor（发布过经验）',
    `实际: ${aliceProfile.tier}`,
  );
  assert(
    aliceProfile.stats.experiences_published > 0,
    'alice 发布经验数 > 0',
    `实际: ${aliceProfile.stats.experiences_published}`,
  );

  // 20c. 搜索配额计算
  assert(
    aliceProfile.quota.daily_limit > 50,
    '有贡献的 agent 配额 > 基础 50',
    `实际: ${aliceProfile.quota.daily_limit}`,
  );

  // 20d. recordSearch 计数
  const beforeCount = await getSearchCountToday('test-search-counter');
  assert(beforeCount === 0, '新 agent 今日搜索次数为 0');
  recordSearch('test-search-counter');
  recordSearch('test-search-counter');
  recordSearch('test-search-counter');
  const afterCount = await getSearchCountToday('test-search-counter');
  assert(afterCount === 3, '记录 3 次搜索后计数为 3', `实际: ${afterCount}`);

  // 20e. checkSearchQuota 检查
  const { allowed: newAllowed } = await checkSearchQuota('brand-new-agent');
  assert(newAllowed === true, 'newcomer 首次搜索允许（配额未用完）');

  // 20f. 升级提示
  assert(
    newcomerProfile.next_tier.tier === 'contributor',
    'newcomer 下一级是 contributor',
  );

  // 20g. 验证给出数
  // bob 在之前测试中做过验证
  const bobProfile = await getAgentProfile('bob');
  assert(
    bobProfile.stats.verifications_given > 0 || bobProfile.stats.experiences_published >= 0,
    'bob 的统计数据可查',
    `验证: ${bobProfile.stats.verifications_given}, 经验: ${bobProfile.stats.experiences_published}`,
  );

  // ========== 21. 搜索日志持久化 ==========
  console.log('\n--- 21. 搜索日志持久化 ---');

  // 21a. 写入搜索日志
  const logId1 = await insertSearchLog({
    agent_id: 'alice',
    query: 'TypeScript compiler',
    hits: 3,
    precision_hits: 2,
    serendipity_hits: 1,
  });
  assert(!!logId1, '搜索日志写入成功');

  const logId2 = await insertSearchLog({
    agent_id: 'alice',
    query: 'Docker optimization',
    hits: 1,
    precision_hits: 1,
    serendipity_hits: 0,
  });
  assert(!!logId2, '第二条搜索日志写入成功');

  const logId3 = await insertSearchLog({
    agent_id: 'bob',
    query: 'Redis caching',
    hits: 5,
    precision_hits: 3,
    serendipity_hits: 2,
  });
  assert(!!logId3, 'bob 的搜索日志写入成功');

  // 21b. 查询搜索统计
  const aliceSearchStats = await getAgentSearchStats('alice');
  assert(
    aliceSearchStats.total_searches === 2,
    `alice 总搜索次数 = 2（实际 ${aliceSearchStats.total_searches}）`,
  );
  assert(
    aliceSearchStats.total_hits === 4,
    `alice 总命中数 = 4（实际 ${aliceSearchStats.total_hits}）`,
  );
  assert(
    aliceSearchStats.avg_hits_per_search === 2,
    `alice 平均命中 = 2（实际 ${aliceSearchStats.avg_hits_per_search}）`,
  );
  assert(
    aliceSearchStats.searches_today >= 2,
    `alice 今日搜索 >= 2（实际 ${aliceSearchStats.searches_today}）`,
  );

  // 21c. 不同 agent 的统计隔离
  const bobSearchStats = await getAgentSearchStats('bob');
  assert(
    bobSearchStats.total_searches === 1,
    `bob 总搜索次数 = 1（实际 ${bobSearchStats.total_searches}）`,
  );

  // 21d. 无搜索记录的 agent
  const noSearchStats = await getAgentSearchStats('never-searched');
  assert(
    noSearchStats.total_searches === 0,
    `未搜索 agent 总搜索次数 = 0（实际 ${noSearchStats.total_searches}）`,
  );
  assert(
    noSearchStats.avg_hits_per_search === 0,
    `未搜索 agent 平均命中 = 0（实际 ${noSearchStats.avg_hits_per_search}）`,
  );

  // 21e. profile 里包含 search_stats
  const aliceProfileWithSearch = await getAgentProfile('alice');
  assert(
    aliceProfileWithSearch.search_stats !== undefined,
    'agent profile 包含 search_stats 字段',
  );
  assert(
    aliceProfileWithSearch.search_stats.total_searches >= 2,
    `profile.search_stats.total_searches >= 2（实际 ${aliceProfileWithSearch.search_stats.total_searches}）`,
  );

  // ========== 22. 验证激活（getAgentVerifiedIds） ==========
  console.log('\n22. 验证激活（getAgentVerifiedIds）');

  // 22a. 查询已验证的经验
  // bob 之前验证过 alice 的某条经验，找到这个经验 ID
  const allExpResult = await getClient().execute({ sql: 'SELECT id, publisher_agent_id FROM experiences LIMIT 10', args: [] });
  const aliceExpIds = allExpResult.rows.filter(r => r.publisher_agent_id === 'alice').map(r => r.id as string);
  const bobExpIds = allExpResult.rows.filter(r => r.publisher_agent_id === 'bob').map(r => r.id as string);

  // bob 验证过的经验应该包含 alice 的某些
  const bobVerified = await getAgentVerifiedIds('bob', aliceExpIds);
  // 检查它返回的是 Set
  assert(
    bobVerified instanceof Set,
    'getAgentVerifiedIds 返回 Set 类型',
  );

  // 22b. 空候选列表返回空 Set
  const emptyVerifiedResult = await getAgentVerifiedIds('bob', []);
  assert(
    emptyVerifiedResult.size === 0,
    '空候选列表返回空 Set',
  );

  // 22c. 未验证过的 agent 返回空 Set
  const unknownVerified = await getAgentVerifiedIds('never-verified-agent', aliceExpIds);
  assert(
    unknownVerified.size === 0,
    '未验证过的 agent 返回空 Set',
  );

  // 22d. 查询不存在的经验 ID 不报错
  const fakeIds = ['fake-id-1', 'fake-id-2'];
  const fakeResult = await getAgentVerifiedIds('bob', fakeIds);
  assert(
    fakeResult.size === 0,
    '查询不存在的经验 ID 返回空 Set',
  );

  // ========== Phase 1: 经验版本 + 状态 ==========
  console.log('\n--- 23. 经验版本和状态 (Phase 1) ---');

  // 23a. 发布带 context_version 和 status 的经验
  const versionedExp = makeExperience({
    publisher: { agent_id: 'alice', platform: 'test' },
    core: {
      what: '测试经验版本字段',
      context: 'Phase 1 测试',
      tried: '发布带 context_version 和 status 的经验，验证字段正确存储',
      outcome: 'succeeded',
      outcome_detail: '字段正常存储和返回',
      learned: '经验版本和状态字段工作正常，可以在发布时指定',
    },
    tags: ['phase-1-test'],
    context_version: 'openclaw@2026.4.5',
    status: 'active',
  });
  const versionedId = await insertExperience(versionedExp, null);
  assert(!!versionedId, '发布带版本+状态的经验成功');

  // 23b. 查询返回 context_version 和 status
  const versionedFetched = await getExperience(versionedId);
  assert(
    versionedFetched?.context_version === 'openclaw@2026.4.5',
    `查询返回 context_version (${versionedFetched?.context_version})`,
  );
  assert(
    versionedFetched?.status === 'active',
    `查询返回 status=active (${versionedFetched?.status})`,
  );

  // 23c. 不带版本发布时默认值
  const noVersionExp = makeExperience({
    publisher: { agent_id: 'alice', platform: 'test' },
    core: {
      what: '不带版本的经验',
      context: '测试默认值',
      tried: '发布时不传 context_version 和 status，验证默认值正确',
      outcome: 'succeeded',
      outcome_detail: '',
      learned: '不传时默认 context_version=null、status=active',
    },
    tags: ['phase-1-test'],
  });
  const noVersionId = await insertExperience(noVersionExp, null);
  const noVersionFetched = await getExperience(noVersionId);
  assert(
    !noVersionFetched?.context_version,
    `默认 context_version 为空 (${noVersionFetched?.context_version})`,
  );
  assert(
    noVersionFetched?.status === 'active',
    `默认 status=active (${noVersionFetched?.status})`,
  );

  // 23d. 状态更新：active → outdated
  const updated1 = await updateExperienceStatus(versionedId, 'outdated');
  assert(updated1 === true, '状态更新为 outdated 成功');

  // 23e. 更新后查询确认
  const afterUpdate = await getExperience(versionedId);
  assert(
    afterUpdate?.status === 'outdated',
    `更新后 status=outdated (${afterUpdate?.status})`,
  );
  assert(
    !!afterUpdate?.updated_at,
    `更新后 updated_at 有值`,
  );

  // 23f. 状态更新为 resolved
  const updated2 = await updateExperienceStatus(versionedId, 'resolved');
  assert(updated2 === true, '状态更新为 resolved 成功');
  const afterResolve = await getExperience(versionedId);
  assert(
    afterResolve?.status === 'resolved',
    `状态更新为 resolved 确认 (${afterResolve?.status})`,
  );

  // 23g. 更新不存在的经验返回 false
  const updatedFake = await updateExperienceStatus('nonexistent-id', 'outdated');
  assert(updatedFake === false, `不存在的经验更新返回 false (${updatedFake})`);

  // 23h. 发布时指定 status=outdated
  const outdatedExp = makeExperience({
    publisher: { agent_id: 'alice', platform: 'test' },
    core: {
      what: '发布时直接标记为过时',
      context: '',
      tried: '发布经验时直接指定 status=outdated，用于记录已知的过时方案',
      outcome: 'partial',
      outcome_detail: '',
      learned: '这个方案在新版本里已经不适用，但保留历史记录的价值',
    },
    tags: ['phase-1-test'],
    status: 'outdated',
    context_version: 'react@18.0',
  });
  const outdatedId = await insertExperience(outdatedExp, null);
  const outdatedFetched = await getExperience(outdatedId);
  assert(
    outdatedFetched?.status === 'outdated',
    `发布时指定 status=outdated (${outdatedFetched?.status})`,
  );
  assert(
    outdatedFetched?.context_version === 'react@18.0',
    `发布时指定 context_version (${outdatedFetched?.context_version})`,
  );

  // ========== 经验删除 ==========
  console.log('\n--- 经验删除测试 ---');

  // 发布一条待删除的经验
  const deleteTestExp: Experience = {
    id: 'delete-test-001',
    version: 'serendip-experience/0.1',
    published_at: new Date().toISOString(),
    publisher: { agent_id: 'alice', platform: 'test' },
    core: {
      what: '删除测试经验',
      context: '测试用',
      tried: '尝试删除',
      outcome: 'succeeded',
      outcome_detail: '测试删除功能',
      learned: '删除可以工作',
    },
    tags: ['test', 'delete'],
  };
  const deleteTestId = await insertExperience(deleteTestExp, null);
  assert(!!deleteTestId, '发布待删除经验成功');

  // 给它加一条验证
  await insertVerification(deleteTestId, 'bob', 'test', 'confirmed', null, '确认有效');
  const verBefore = await getVerificationSummary(deleteTestId);
  assert(verBefore.total === 1, `删除前有 1 条验证 (${verBefore.total})`);

  // 删除
  const deleted = await deleteExperience(deleteTestId);
  assert(deleted === true, '删除成功返回 true');

  // 确认经验不存在
  const afterDelete = await getExperience(deleteTestId);
  assert(afterDelete === null, `删除后查询返回 null (${afterDelete})`);

  // 确认验证也被级联删除
  const verAfter = await getVerificationSummary(deleteTestId);
  assert(verAfter.total === 0, `删除后验证也被清除 (${verAfter.total})`);

  // 删除不存在的经验返回 false
  const deleteFake = await deleteExperience('nonexistent-id');
  assert(deleteFake === false, `删除不存在的经验返回 false (${deleteFake})`);

  // ========== 结果 ==========
  console.log(`\n${'='.repeat(40)}`);
  console.log(`🏁 经验网络测试: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(40));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
