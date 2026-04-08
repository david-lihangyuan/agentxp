/**
 * 用户注册 + API key 管理 集成测试
 *
 * MOCK_EMBEDDINGS=true npx tsx src/test-auth.ts
 */

import { initDB, getClient, getAgentByKey } from './db.js';
import { initEmbedding } from './embedding.js';
import {
  registerUser, getUserByAgentId, listUserKeys, revokeApiKey,
} from './shared-auth.js';
import { randomUUID } from 'node:crypto';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

async function run() {
  // 用临时内存库
  const dbUrl = 'file::memory:?cache=shared';
  await initDB(dbUrl);
  initEmbedding('mock', undefined, true);

  const client = getClient();

  console.log('\n--- 1. 新用户注册 ---');
  const agent1 = `test-agent-${randomUUID().slice(0, 8)}`;
  const result1 = await registerUser(client, { agent_id: agent1, name: '测试 Agent' });
  assert(result1.status === 'created', `新用户状态为 created（实际: ${result1.status}）`);
  assert(result1.agent_id === agent1, `agent_id 正确`);
  assert(result1.api_key.startsWith('sxp_'), `API key 以 sxp_ 开头（实际: ${result1.api_key.slice(0, 8)}...）`);
  assert(result1.api_key.length === 4 + 64, `API key 长度正确（4 + 64 = 68，实际: ${result1.api_key.length}）`);
  assert(result1.user_id.length > 0, `user_id 非空`);

  console.log('\n--- 2. 通过 API key 查询 agent_id ---');
  const foundAgent = await getAgentByKey(result1.api_key);
  assert(foundAgent === agent1, `getAgentByKey 返回正确的 agent_id`);

  const badKey = await getAgentByKey('sxp_fake_key_does_not_exist');
  assert(badKey === null, `无效 key 返回 null`);

  console.log('\n--- 3. 重复注册同一 agent_id ---');
  const result2 = await registerUser(client, { agent_id: agent1 });
  assert(result2.status === 'existing', `重复注册状态为 existing`);
  assert(result2.user_id === result1.user_id, `user_id 不变`);
  assert(result2.api_key !== result1.api_key, `生成了新的 API key`);
  assert(result2.api_key.startsWith('sxp_'), `新 key 也以 sxp_ 开头`);

  // 两个 key 都应该有效
  const found1 = await getAgentByKey(result1.api_key);
  const found2 = await getAgentByKey(result2.api_key);
  assert(found1 === agent1, `旧 key 仍然有效`);
  assert(found2 === agent1, `新 key 也有效`);

  console.log('\n--- 4. 查询用户信息 ---');
  const userInfo = await getUserByAgentId(client, agent1);
  assert(userInfo !== null, `用户存在`);
  assert(userInfo!.agent_id === agent1, `agent_id 正确`);
  assert(userInfo!.name === '测试 Agent', `name 正确`);

  const noUser = await getUserByAgentId(client, 'nonexistent-agent');
  assert(noUser === null, `不存在的用户返回 null`);

  console.log('\n--- 5. 列出 API keys ---');
  const keys = await listUserKeys(client, agent1);
  assert(keys.length === 2, `有 2 个 key（实际: ${keys.length}）`);
  assert(keys[0].key_prefix.startsWith('sxp_'), `key 前缀正确`);
  assert(keys[0].key_prefix.endsWith('...'), `key 脱敏显示`);

  console.log('\n--- 6. 撤销 API key ---');
  const revoked = await revokeApiKey(client, agent1, result1.api_key);
  assert(revoked === true, `撤销成功`);

  const afterRevoke = await getAgentByKey(result1.api_key);
  assert(afterRevoke === null, `撤销后 key 无效`);

  const stillValid = await getAgentByKey(result2.api_key);
  assert(stillValid === agent1, `另一个 key 仍然有效`);

  const keysAfter = await listUserKeys(client, agent1);
  assert(keysAfter.length === 1, `撤销后只剩 1 个 key（实际: ${keysAfter.length}）`);

  // 撤销不存在的 key
  const revokedBad = await revokeApiKey(client, agent1, 'sxp_nonexistent');
  assert(revokedBad === false, `撤销不存在的 key 返回 false`);

  console.log('\n--- 7. API key 上限 ---');
  // 已有 1 个 key，再注册 4 个
  for (let i = 0; i < 4; i++) {
    await registerUser(client, { agent_id: agent1 });
  }
  const keysMax = await listUserKeys(client, agent1);
  assert(keysMax.length === 5, `达到 5 个 key 上限（实际: ${keysMax.length}）`);

  // 第 6 个应该报错
  let hitLimit = false;
  try {
    await registerUser(client, { agent_id: agent1 });
  } catch (err: any) {
    hitLimit = err.message.includes('上限');
  }
  assert(hitLimit, `超过上限时抛出错误`);

  console.log('\n--- 8. agent_id 为空 ---');
  let emptyError = false;
  try {
    await registerUser(client, { agent_id: '' });
  } catch (err: any) {
    emptyError = err.message.includes('不能为空');
  }
  assert(emptyError, `空 agent_id 抛出错误`);

  console.log('\n--- 9. 多用户隔离 ---');
  const agent2 = `test-agent-${randomUUID().slice(0, 8)}`;
  const result3 = await registerUser(client, { agent_id: agent2 });
  assert(result3.status === 'created', `第二个用户注册成功`);
  assert(result3.user_id !== result1.user_id, `不同用户 user_id 不同`);

  // agent2 不能撤销 agent1 的 key
  const crossRevoke = await revokeApiKey(client, agent2, result2.api_key);
  assert(crossRevoke === false, `不能跨用户撤销 key`);

  console.log(`\n========================================`);
  console.log(`🏁 用户注册测试: ${passed} 通过, ${failed} 失败`);
  console.log(`========================================`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
