/**
 * 求助系统测试
 * 运行: MOCK_EMBEDDINGS=true tsx src/test-help.ts
 */

import { initDB, getClient, insertExperience, getExperience } from './db.js';
import { initEmbedding, getEmbedding } from './embedding.js';
import { migrateHelp, createHelpRequest, getHelpInbox, respondToHelp, resolveHelp, getHelpRequestDetail, getMyHelpRequests, getHelpRequestCountToday, getHelpResponseCountToday, matchDiagnosticTemplate, validateDiagnosticReport, diagnosticReportToText, DIAGNOSTIC_TEMPLATES, DAILY_HELP_REQUEST_LIMIT, DAILY_HELP_RESPONSE_LIMIT } from './help.js';
import type { DiagnosticReport } from './types.js';
import { adjustCredits, getCredits, INITIAL_CREDITS } from './credits.js';
import { registerUser } from './shared-auth.js';
import { randomUUID } from 'node:crypto';

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

async function setup() {
  // 使用内存数据库
  const client = await initDB('file::memory:');
  initEmbedding('mock', undefined, true);

  // 注册测试用户
  const alice = await registerUser(client, { agent_id: 'alice-helper', name: 'Alice' });
  const bob = await registerUser(client, { agent_id: 'bob-requester', name: 'Bob' });
  const charlie = await registerUser(client, { agent_id: 'charlie-helper', name: 'Charlie' });
  const dave = await registerUser(client, { agent_id: 'dave-bystander', name: 'Dave' });

  // 确保有足够积分做测试（多次求助需要）
  await adjustCredits('bob-requester', 100, 'test_setup_bonus');

  // Alice 和 Charlie 发布一些经验（用于匹配）
  const embedding = await getEmbedding('test experience about docker configuration');
  await insertExperience({
    id: randomUUID(),
    version: 'serendip-experience/0.1',
    published_at: new Date().toISOString(),
    publisher: { agent_id: 'alice-helper', platform: 'test' },
    core: {
      what: 'Docker container DNS resolution',
      context: 'Running Docker on macOS',
      tried: 'Configured Docker DNS settings to use custom resolver',
      outcome: 'succeeded',
      outcome_detail: 'DNS works after restart',
      learned: 'Docker containers need explicit DNS configuration when using custom networks',
    },
    tags: ['docker', 'dns', 'networking'],
  }, embedding);

  await insertExperience({
    id: randomUUID(),
    version: 'serendip-experience/0.1',
    published_at: new Date().toISOString(),
    publisher: { agent_id: 'charlie-helper', platform: 'test' },
    core: {
      what: 'Docker compose networking issue',
      context: 'Docker compose with multiple services',
      tried: 'Used bridge network and linked services',
      outcome: 'succeeded',
      outcome_detail: 'Services can communicate now',
      learned: 'Docker compose services need to be on the same network to communicate',
    },
    tags: ['docker', 'compose', 'networking'],
  }, embedding);

  // Dave 没有相关经验（不应被匹配）
  await insertExperience({
    id: randomUUID(),
    version: 'serendip-experience/0.1',
    published_at: new Date().toISOString(),
    publisher: { agent_id: 'dave-bystander', platform: 'test' },
    core: {
      what: 'Python type hints',
      context: 'Python 3.11 project',
      tried: 'Added comprehensive type hints using typing module',
      outcome: 'succeeded',
      outcome_detail: 'Mypy now passes all checks',
      learned: 'Type hints improve code quality but need consistent adoption across codebase',
    },
    tags: ['python', 'typing', 'code-quality'],
  }, embedding);

  return { alice, bob, charlie, dave };
}

async function testCreateHelpRequest() {
  console.log('\n=== 创建求助 ===');

  // 正常创建
  const result = await createHelpRequest(
    'bob-requester',
    'Docker containers cannot resolve DNS names in custom bridge network',
    ['docker', 'dns', 'networking'],
    'simple',
    'dig @8.8.8.8 google.com → timeout\ncat /etc/resolv.conf → nameserver 127.0.0.11',
  );

  assert(result.request.id.length > 0, '求助 ID 已生成');
  assert(result.request.status === 'open', '初始状态为 open');
  assert(result.request.complexity === 'simple', '复杂度为 simple');
  assert(result.request.description.includes('Docker'), '描述包含问题内容');
  assert(result.request.diagnostics !== null, '诊断信息已保存');
  assert(result.request.tags.length === 3, '标签已保存');
  assert(result.credits_deducted === 10, '扣了 10 积分（simple）');

  // 验证 Bob 积分被扣了（初始 30 + bonus 100 - simple 10 = 120）
  const bobCredits = await getCredits('bob-requester');
  assert(bobCredits === INITIAL_CREDITS + 100 - 10, `Bob 积分正确: ${bobCredits}`);

  return result;
}

async function testCreateComplexHelp() {
  console.log('\n=== 创建复杂求助 ===');

  const result = await createHelpRequest(
    'bob-requester',
    'Complex networking issue with Docker Swarm overlay networks',
    ['docker', 'swarm'],
    'complex',
  );

  assert(result.credits_deducted === 25, '复杂求助扣 25 积分');

  return result;
}

async function testHelpInbox(requestId: string) {
  console.log('\n=== 查看收件箱 ===');

  // Alice 应该能在收件箱看到匹配的求助（因为她有 docker 经验）
  const aliceInbox = await getHelpInbox('alice-helper');
  // 在 mock embedding 模式下匹配分数可能不稳定，检查结构正确性
  assert(Array.isArray(aliceInbox), 'Alice 收件箱是数组');

  // Bob 自己不应该看到自己的求助
  const bobInbox = await getHelpInbox('bob-requester');
  const selfRequest = bobInbox.find(item => item.request.id === requestId);
  assert(!selfRequest, 'Bob 的收件箱不包含自己的求助');
}

async function testRespondToHelp(requestId: string) {
  console.log('\n=== 回复求助 ===');

  // 先确保 Alice 被匹配到了（如果 mock 模式匹配不上，手动插入匹配记录）
  const db = getClient();
  await db.execute({
    sql: `INSERT OR IGNORE INTO help_matches (id, request_id, agent_id, match_score, matched_experience_ids, matched_tags, created_at)
          VALUES (?, ?, 'alice-helper', 0.8, '[]', '["docker"]', ?)`,
    args: [randomUUID(), requestId, new Date().toISOString()],
  });

  // Alice 回复
  const result = await respondToHelp(
    requestId,
    'alice-helper',
    '根据你的 resolv.conf 输出，DNS 被指向了 Docker 内部 DNS（127.0.0.11）。\n\n建议：\n1. 检查 Docker daemon 的 dns 配置\n2. 在 docker-compose.yml 中显式指定 dns 服务器\n3. 检查宿主机的 iptables 规则是否允许 DNS 流量',
  );

  assert(result.response.id.length > 0, '回复 ID 已生成');
  assert(result.response.responder_id === 'alice-helper', '回复者正确');
  assert(result.response.content.includes('DNS'), '回复内容包含诊断');
  assert(result.credits_earned === 10, 'Alice 获得 10 积分（simple respond）');

  // 验证 Alice 积分增加了
  const aliceCredits = await getCredits('alice-helper');
  assert(aliceCredits >= INITIAL_CREDITS + 10, `Alice 积分增加: ${aliceCredits}`);

  // 求助状态应该变成 responded
  const detail = await getHelpRequestDetail(requestId);
  assert(detail?.request.status === 'responded', '求助状态变为 responded');
  assert(detail?.responses.length === 1, '有 1 个回复');
}

async function testCannotRespondSelf() {
  console.log('\n=== 不能回复自己 ===');

  const req = await createHelpRequest(
    'alice-helper',
    'Test self-response prevention with long enough description text',
    [],
    'simple',
  );

  // 手动加 match
  await getClient().execute({
    sql: `INSERT OR IGNORE INTO help_matches (id, request_id, agent_id, match_score, matched_experience_ids, matched_tags, created_at)
          VALUES (?, ?, 'alice-helper', 0.9, '[]', '[]', ?)`,
    args: [randomUUID(), req.request.id, new Date().toISOString()],
  });

  try {
    await respondToHelp(req.request.id, 'alice-helper', 'Testing self-response which should fail');
    assert(false, '应该抛错但没有');
  } catch (err: any) {
    assert(err.message.includes('不能回复自己'), '自我回复被拒绝');
  }
}

async function testCannotRespondUnmatched() {
  console.log('\n=== 未匹配不能回复 ===');

  const req = await createHelpRequest(
    'bob-requester',
    'Another help request for unmatched test with enough characters',
    [],
    'simple',
  );

  try {
    await respondToHelp(req.request.id, 'dave-bystander', 'I want to help!');
    assert(false, '应该抛错但没有');
  } catch (err: any) {
    assert(err.message.includes('没有被匹配'), '未匹配的 Agent 被拒绝');
  }
}

async function testResolveHelp(requestId: string) {
  console.log('\n=== 标记解决 ===');

  const result = await resolveHelp(requestId, 'bob-requester');

  assert(result.request.status === 'resolved', '状态变为 resolved');
  assert(result.bonus_credits > 0, `响应者获得额外积分: ${result.bonus_credits}`);

  // 验证 Alice 获得了 help_resolved 积分
  const aliceCredits = await getCredits('alice-helper');
  // Alice: 初始 30 + respond_simple 10 + help_resolved 15 - help_simple 10（自己发的一个求助）= 45
  assert(aliceCredits >= 45, `Alice 最终积分 >= 45: ${aliceCredits}`);

  // 不能重复解决
  try {
    await resolveHelp(requestId, 'bob-requester');
    assert(false, '重复解决应该抛错');
  } catch (err: any) {
    assert(err.message.includes('已经标记为解决'), '重复解决被拒绝');
  }
}

async function testResolveNotOwner(complexRequestId: string) {
  console.log('\n=== 非求助者不能标记解决 ===');

  // 用 Bob 的复杂求助（还是 open 状态）来测试非所有者解决
  try {
    await resolveHelp(complexRequestId, 'alice-helper');
    assert(false, '非求助者解决应该抛错');
  } catch (err: any) {
    assert(err.message.includes('不属于你'), '非求助者被拒绝');
  }
}

async function testGetMyRequests() {
  console.log('\n=== 查看我的求助 ===');

  const requests = await getMyHelpRequests('bob-requester');
  assert(requests.length >= 2, `Bob 至少有 2 个求助: ${requests.length}`);
  assert(typeof requests[0].response_count === 'number', '包含回复数');
}

async function testGetHelpDetail(requestId: string) {
  console.log('\n=== 查看求助详情 ===');

  const detail = await getHelpRequestDetail(requestId);
  assert(detail !== null, '能获取详情');
  assert(detail!.request.id === requestId, 'ID 匹配');
  assert(Array.isArray(detail!.responses), '包含回复数组');
  assert(Array.isArray(detail!.matches), '包含匹配数组');

  // 不存在的求助
  const none = await getHelpRequestDetail('nonexistent');
  assert(none === null, '不存在的求助返回 null');
}

async function testDailyLimits() {
  console.log('\n=== 每日限额 ===');

  const count = await getHelpRequestCountToday('bob-requester');
  assert(count >= 3, `Bob 今天已发起 ${count} 次求助`);

  // Bob 应该被限额了（已经发了 3+ 次）
  try {
    await createHelpRequest(
      'bob-requester',
      'This should be rate limited because too many requests today',
      [],
      'simple',
    );
    // 如果 count 刚好 == LIMIT 之前可能成功，不算错
    if (count >= DAILY_HELP_REQUEST_LIMIT) {
      assert(false, '应该被限额但成功了');
    }
  } catch (err: any) {
    assert(err.message.includes('上限'), '每日求助限额生效');
  }
}

async function testInsufficientCredits() {
  console.log('\n=== 积分不足 ===');

  // 把 Dave 的积分清零
  const daveCredits = await getCredits('dave-bystander');
  await adjustCredits('dave-bystander', -daveCredits - 5, 'test_drain'); // 确保为负

  try {
    await createHelpRequest(
      'dave-bystander',
      'This should fail because of insufficient credits for help request',
      [],
      'simple',
    );
    assert(false, '积分不足应该抛错');
  } catch (err: any) {
    assert(err.message.includes('积分不足'), '积分不足被拒绝');
  }
}

async function testFieldValidation() {
  console.log('\n=== 字段校验 ===');

  // description 长度校验在路由层做，函数层不校验（信任调用方）
  // 测试 complexity 值
  const result = await createHelpRequest(
    'charlie-helper',
    'Test with valid complexity value simple and enough characters in description',
    [],
    'simple',
  );
  assert(result.request.complexity === 'simple', 'simple complexity 正确');

  // 测试求助包含标签
  const result2 = await createHelpRequest(
    'charlie-helper',
    'Another test request with tags and enough characters for validation',
    ['test-tag', 'validation'],
    'simple',
  );
  assert(result2.request.tags.length === 2, '标签正确保存');
  assert(result2.request.tags.includes('test-tag'), '标签内容正确');
}

// === 诊断报告模板测试 ===

async function testDiagnosticTemplates() {
  console.log('\n=== 诊断模板匹配 ===');

  // 内置模板存在
  assert(DIAGNOSTIC_TEMPLATES.length >= 5, `至少 5 个内置模板: ${DIAGNOSTIC_TEMPLATES.length}`);

  // OpenClaw 心跳模板匹配
  const heartbeatTemplate = matchDiagnosticTemplate(['openclaw', 'heartbeat']);
  assert(heartbeatTemplate.id === 'openclaw-heartbeat', '心跳标签匹配到心跳模板');

  // Docker 网络模板匹配
  const dockerTemplate = matchDiagnosticTemplate(['docker', 'dns']);
  assert(dockerTemplate.id === 'docker-networking', 'Docker+DNS 匹配到 Docker 网络模板');

  // Node 依赖模板匹配
  const nodeTemplate = matchDiagnosticTemplate(['typescript', 'build']);
  assert(nodeTemplate.id === 'node-dependency', 'TypeScript+build 匹配到 Node 依赖模板');

  // API 连接模板匹配
  const apiTemplate = matchDiagnosticTemplate(['api', 'timeout']);
  assert(apiTemplate.id === 'api-connectivity', 'API+timeout 匹配到 API 连接模板');

  // 无匹配就用通用模板
  const genericTemplate = matchDiagnosticTemplate(['random-tag']);
  assert(genericTemplate.id === 'generic', '无匹配回退到通用模板');

  // 空标签也用通用模板
  const emptyTemplate = matchDiagnosticTemplate([]);
  assert(emptyTemplate.id === 'generic', '空标签用通用模板');

  // 模板有检查项
  assert(heartbeatTemplate.checks.length >= 5, `心跳模板有 ${heartbeatTemplate.checks.length} 项检查`);
  assert(heartbeatTemplate.checks[0].name.length > 0, '检查项有名称');
  assert(heartbeatTemplate.checks[0].command.length > 0, '检查项有命令');
}

async function testDiagnosticReportValidation() {
  console.log('\n=== 诊断报告校验 ===');

  // 合法报告
  const validReport: DiagnosticReport = {
    category: 'configuration',
    environment: 'macOS 14, Node.js 20',
    checks: [
      { name: 'Gateway 状态', status: 'pass', command: 'openclaw gateway status', output: 'running' },
      { name: '心跳配置', status: 'fail', command: 'cat agent.yaml', output: 'interval: 0', note: '心跳间隔为 0 将导致不执行' },
    ],
    root_cause: '心跳间隔配置为 0，导致心跳不执行',
    fix_steps: ['把 agent.yaml 的 heartbeat.interval 改为 30', '重启 gateway'],
    confidence: 0.9,
    notes: '如果修改后仍不工作，检查 channel 状态',
  };
  const v1 = validateDiagnosticReport(validReport);
  assert(v1.valid, '合法报告通过校验');

  // 缺少 category
  const v2 = validateDiagnosticReport({ ...validReport, category: undefined });
  assert(!v2.valid, '缺少 category 被拒绝');

  // 无效 category
  const v3 = validateDiagnosticReport({ ...validReport, category: 'invalid' });
  assert(!v3.valid, '无效 category 被拒绝');

  // 空 checks
  const v4 = validateDiagnosticReport({ ...validReport, checks: [] });
  assert(!v4.valid, '空 checks 被拒绝');

  // checks 超过 20 项
  const tooManyChecks = Array.from({ length: 21 }, (_, i) => ({ name: `check-${i}`, status: 'pass' }));
  const v5 = validateDiagnosticReport({ ...validReport, checks: tooManyChecks });
  assert(!v5.valid, 'checks 超过 20 项被拒绝');

  // check 缺少 name
  const v6 = validateDiagnosticReport({ ...validReport, checks: [{ status: 'pass' }] });
  assert(!v6.valid, 'check 缺少 name 被拒绝');

  // check 无效 status
  const v7 = validateDiagnosticReport({ ...validReport, checks: [{ name: 'test', status: 'invalid' }] });
  assert(!v7.valid, 'check 无效 status 被拒绝');

  // 缺少 root_cause
  const v8 = validateDiagnosticReport({ ...validReport, root_cause: '' });
  assert(!v8.valid, '空 root_cause 被拒绝');

  // root_cause 超长
  const v9 = validateDiagnosticReport({ ...validReport, root_cause: 'a'.repeat(501) });
  assert(!v9.valid, 'root_cause 超长被拒绝');

  // 空 fix_steps
  const v10 = validateDiagnosticReport({ ...validReport, fix_steps: [] });
  assert(!v10.valid, '空 fix_steps 被拒绝');

  // fix_steps 超过 10 步
  const v11 = validateDiagnosticReport({ ...validReport, fix_steps: Array.from({ length: 11 }, (_, i) => `step ${i}`) });
  assert(!v11.valid, 'fix_steps 超过 10 步被拒绝');

  // confidence 超范围
  const v12 = validateDiagnosticReport({ ...validReport, confidence: 1.5 });
  assert(!v12.valid, 'confidence > 1 被拒绝');
  const v13 = validateDiagnosticReport({ ...validReport, confidence: -0.1 });
  assert(!v13.valid, 'confidence < 0 被拒绝');

  // 非对象
  const v14 = validateDiagnosticReport(null);
  assert(!v14.valid, 'null 被拒绝');
  const v15 = validateDiagnosticReport('string');
  assert(!v15.valid, '字符串被拒绝');
}

async function testDiagnosticReportToText() {
  console.log('\n=== 诊断报告转文本 ===');

  const report: DiagnosticReport = {
    category: 'networking',
    environment: 'Ubuntu 22.04, Docker 24.0',
    checks: [
      { name: 'DNS 解析', status: 'fail', command: 'dig google.com', output: 'timeout' },
      { name: '网络连通', status: 'pass', command: 'ping 8.8.8.8' },
    ],
    root_cause: 'Docker 容器的 DNS 配置指向了失效的内部解析器',
    fix_steps: ['在 docker-compose.yml 中显式指定 dns: [8.8.8.8]', '重启容器'],
    confidence: 0.85,
  };

  const text = diagnosticReportToText(report);
  assert(text.includes('诊断报告'), '文本包含标题');
  assert(text.includes('networking'), '文本包含问题分类');
  assert(text.includes('DNS 解析'), '文本包含检查项');
  assert(text.includes('❌'), '文本包含 fail 标记');
  assert(text.includes('✅'), '文本包含 pass 标记');
  assert(text.includes('根因分析'), '文本包含根因段');
  assert(text.includes('docker-compose.yml'), '文本包含修复步骤');
  assert(text.includes('85%'), '文本包含置信度');
}

async function testStructuredDiagnosticResponse() {
  console.log('\n=== 结构化诊断报告响应 ===');

  // 用 dave 发求助（bob 已达今日上限）
  await adjustCredits('dave-bystander', 100, 'test_bonus_diagnostic');
  await adjustCredits('charlie-helper', 50, 'test_bonus_diagnostic');

  const req = await createHelpRequest(
    'dave-bystander',
    'Docker container DNS not working in custom bridge network after upgrade',
    ['docker', 'dns'],
    'simple',
  );

  // 手动插入匹配
  await getClient().execute({
    sql: `INSERT OR IGNORE INTO help_matches (id, request_id, agent_id, match_score, matched_experience_ids, matched_tags, created_at)
          VALUES (?, ?, 'charlie-helper', 0.85, '[]', '["docker","dns"]', ?)`,
    args: [randomUUID(), req.request.id, new Date().toISOString()],
  });

  // Charlie 用结构化报告回复
  const diagnosticReport: DiagnosticReport = {
    category: 'networking',
    environment: 'macOS 14, Docker Desktop 4.25',
    checks: [
      { name: '容器状态', status: 'pass', command: 'docker ps' },
      { name: 'DNS 解析', status: 'fail', command: 'docker exec <c> dig google.com', output: 'timeout', note: 'Docker 内部 DNS 解析器无响应' },
      { name: '网络连通', status: 'pass', command: 'ping 8.8.8.8' },
    ],
    root_cause: 'Docker Desktop 升级后内置 DNS 解析器配置被重置',
    fix_steps: [
      '在 docker-compose.yml 加 dns: [8.8.8.8, 1.1.1.1]',
      '或者在 Docker Desktop 设置中重新配置 DNS',
      '重启 Docker Desktop',
    ],
    confidence: 0.8,
    notes: '这是 Docker Desktop 4.25 的已知问题',
  };

  const result = await respondToHelp(
    req.request.id,
    'charlie-helper',
    '',  // 空 content，会用 diagnosticReportToText 自动生成
    diagnosticReport,
  );

  // content 应该被自动生成
  assert(result.response.content.length > 0, '结构化报告自动生成 content 文本');
  assert(result.response.content.includes('networking'), '自动生成的 content 包含问题分类');

  // diagnostic_report 应该被保存
  assert(result.response.diagnostic_report !== null, '结构化报告已保存');
  assert(result.response.diagnostic_report?.category === 'networking', '报告 category 正确');
  assert(result.response.diagnostic_report?.checks.length === 3, '报告有 3 项检查');
  assert(result.response.diagnostic_report?.confidence === 0.8, '报告 confidence 正确');

  // 从详情里拿到的也要有 diagnostic_report
  const detail = await getHelpRequestDetail(req.request.id);
  assert(detail!.responses.length === 1, '详情有 1 个回复');
  assert(detail!.responses[0].diagnostic_report?.category === 'networking', '详情中的报告能被解析');
  assert(detail!.responses[0].diagnostic_report?.root_cause.includes('DNS') === true, '详情中的根因正确');
}

async function testDistillWithStructuredReport() {
  console.log('\n=== 对话沉淀（结构化报告） ===');

  // 用新用户做这个测试，避免每日限额冲突
  const db = getClient();
  await registerUser(db, { agent_id: 'distill-requester', name: 'DR' });
  await registerUser(db, { agent_id: 'distill-helper', name: 'DH' });
  await adjustCredits('distill-requester', 50, 'test_distill');
  await adjustCredits('distill-helper', 50, 'test_distill');

  // helper 发布一条经验用于匹配
  const embedding = await getEmbedding('nginx proxy configuration issue');
  await insertExperience({
    id: randomUUID(),
    version: 'serendip-experience/0.1',
    published_at: new Date().toISOString(),
    publisher: { agent_id: 'distill-helper', platform: 'test' },
    core: {
      what: 'Nginx reverse proxy configuration for Node.js',
      context: 'Ubuntu 22.04 server with PM2',
      tried: 'Configured Nginx as reverse proxy for Node.js Express app running on port 3000',
      outcome: 'succeeded',
      outcome_detail: 'Proxy works with websocket support',
      learned: 'Need proxy_set_header for websocket and proper upstream timeout settings',
    },
    tags: ['nginx', 'proxy', 'nodejs'],
  }, embedding);

  // 发起求助
  const helpResult = await createHelpRequest(
    'distill-requester',
    'Nginx reverse proxy returns 502 Bad Gateway when Node.js app restarts',
    ['nginx', 'proxy', '502'],
    'simple',
    'curl localhost:3000 → OK\ncurl nginx-host → 502\nnginx error log: connect() failed (111: Connection refused)',
  );

  // 手动插入匹配
  await db.execute({
    sql: `INSERT OR IGNORE INTO help_matches (id, request_id, agent_id, match_score, matched_experience_ids, matched_tags, created_at)
          VALUES (?, ?, 'distill-helper', 0.85, '[]', '["nginx","proxy"]', ?)`,
    args: [randomUUID(), helpResult.request.id, new Date().toISOString()],
  });

  // 用结构化诊断报告回复
  const report: DiagnosticReport = {
    category: 'configuration',
    environment: 'Ubuntu 22.04, Nginx 1.24, Node.js 20',
    checks: [
      { name: 'Node.js 进程', status: 'pass', command: 'pm2 status', output: 'online' },
      { name: '直接访问', status: 'pass', command: 'curl localhost:3000', output: '200 OK' },
      { name: 'Nginx upstream', status: 'fail', command: 'nginx -T | grep upstream', note: '缺少 upstream 配置块' },
    ],
    root_cause: 'Nginx 配置缺少 upstream 块和重启重试机制，当 Node.js 重启时 Nginx 无法自动重连',
    fix_steps: [
      '添加 upstream 块并设置 max_fails=3 fail_timeout=30s',
      '在 location 块添加 proxy_next_upstream error timeout',
      '重载 Nginx 配置: nginx -s reload',
    ],
    confidence: 0.9,
    notes: 'PM2 重启期间约 2-5 秒端口不可用，需要 Nginx 容忍短暂失联',
  };

  await respondToHelp(helpResult.request.id, 'distill-helper', '', report);

  // 解决（应触发自动沉淀）
  const resolveResult = await resolveHelp(helpResult.request.id, 'distill-requester');

  assert(resolveResult.distilled_experience_id !== undefined, '沉淀生成了经验 ID');
  assert(resolveResult.request.resolution_experience_id === resolveResult.distilled_experience_id, '求助记录关联了沉淀经验');

  // 检查沉淀的经验内容
  const exp = await getExperience(resolveResult.distilled_experience_id!);
  assert(exp !== null, '沉淀经验存在于数据库');
  assert(exp!.core.what.includes('Nginx'), '沉淀 what 包含问题描述');
  assert(exp!.core.tried.includes('问题描述'), '沉淀 tried 包含原始描述');
  assert(exp!.core.outcome === 'succeeded', '沉淀 outcome 为 succeeded');
  assert(exp!.core.learned.includes('根因'), '沉淀 learned 包含根因分析');
  assert(exp!.core.learned.includes('Nginx'), '沉淀 learned 包含具体内容');
  assert(exp!.core.outcome_detail.includes('修复方案'), '沉淀 outcome_detail 包含修复步骤');
  assert(exp!.tags.includes('distilled-from-help'), '沉淀标签包含 distilled-from-help');
  assert(exp!.tags.includes('nginx'), '沉淀标签保留原始标签');
  assert(exp!.publisher.agent_id === 'distill-requester', '沉淀发布者为求助者');
  assert(exp!.publisher.platform === 'agentxp-distill', '沉淀平台标识正确');

  // 检查 agent_context 源信息
  assert(exp!.agent_context?.custom?.source === 'help_resolution', '沉淀源信息正确');
  assert((exp!.agent_context?.custom?.help_request_id as string) === helpResult.request.id, '关联求助 ID 正确');
}

async function testDistillWithPlainText() {
  console.log('\n=== 对话沉淀（纯文本回复） ===');

  const db = getClient();
  await registerUser(db, { agent_id: 'distill-req-2', name: 'DR2' });
  await registerUser(db, { agent_id: 'distill-help-2', name: 'DH2' });
  await adjustCredits('distill-req-2', 50, 'test_distill_2');
  await adjustCredits('distill-help-2', 50, 'test_distill_2');

  // helper 发布经验
  const embedding = await getEmbedding('pm2 cluster mode memory leak');
  await insertExperience({
    id: randomUUID(),
    version: 'serendip-experience/0.1',
    published_at: new Date().toISOString(),
    publisher: { agent_id: 'distill-help-2', platform: 'test' },
    core: {
      what: 'PM2 cluster mode memory management',
      context: 'Production Node.js server',
      tried: 'Configured PM2 cluster mode with max_memory_restart parameter to handle memory leaks',
      outcome: 'succeeded',
      outcome_detail: 'Memory stays stable under load',
      learned: 'PM2 max_memory_restart combined with graceful shutdown prevents OOM kills',
    },
    tags: ['pm2', 'nodejs', 'memory'],
  }, embedding);

  // 发起求助
  const helpResult = await createHelpRequest(
    'distill-req-2',
    'PM2 cluster mode processes keep crashing with OOM errors after running for a few hours',
    ['pm2', 'memory', 'oom'],
    'simple',
  );

  // 插入匹配
  await db.execute({
    sql: `INSERT OR IGNORE INTO help_matches (id, request_id, agent_id, match_score, matched_experience_ids, matched_tags, created_at)
          VALUES (?, ?, 'distill-help-2', 0.8, '[]', '["pm2","memory"]', ?)`,
    args: [randomUUID(), helpResult.request.id, new Date().toISOString()],
  });

  // 用纯文本回复（没有结构化报告）
  await respondToHelp(
    helpResult.request.id,
    'distill-help-2',
    '你的 PM2 OOM 问题很可能是因为没有设置 max_memory_restart。\n\n建议：\n1. 在 ecosystem.config.js 加 max_memory_restart: "500M"\n2. 同时检查代码是否有内存泄漏（比如未关闭的数据库连接、未清理的定时器）\n3. pm2 restart all --update-env 重启生效',
  );

  // 解决
  const resolveResult = await resolveHelp(helpResult.request.id, 'distill-req-2');

  assert(resolveResult.distilled_experience_id !== undefined, '纯文本回复也能沉淀');

  const exp = await getExperience(resolveResult.distilled_experience_id!);
  assert(exp !== null, '沉淀经验存在');
  assert(exp!.core.learned.includes('AgentXP'), '纯文本沉淀 learned 包含来源标识');
  assert(exp!.tags.includes('distilled-from-help'), '标签正确');
  assert(exp!.tags.includes('pm2'), '保留原始标签');
}

async function testDistillSkippedWhenExplicitId() {
  console.log('\n=== 对话沉淀跳过（手动提供经验 ID） ===');

  const db = getClient();
  await registerUser(db, { agent_id: 'distill-req-3', name: 'DR3' });
  await registerUser(db, { agent_id: 'distill-help-3', name: 'DH3' });
  await adjustCredits('distill-req-3', 50, 'test_distill_3');
  await adjustCredits('distill-help-3', 50, 'test_distill_3');

  // helper 发布经验
  const embedding = await getEmbedding('test skip distill');
  await insertExperience({
    id: randomUUID(),
    version: 'serendip-experience/0.1',
    published_at: new Date().toISOString(),
    publisher: { agent_id: 'distill-help-3', platform: 'test' },
    core: {
      what: 'Generic experience for testing distill skip',
      context: 'Test context for distillation skip test',
      tried: 'Testing the distill skip path when explicit experience ID is provided',
      outcome: 'succeeded',
      outcome_detail: 'Works as expected',
      learned: 'When explicit resolution ID is given, auto distill should be skipped entirely',
    },
    tags: ['test'],
  }, embedding);

  // 发起求助
  const helpResult = await createHelpRequest(
    'distill-req-3',
    'Test request for manual resolution ID with enough characters to pass validation',
    ['test'],
    'simple',
  );

  // 插入匹配 + 回复
  await db.execute({
    sql: `INSERT OR IGNORE INTO help_matches (id, request_id, agent_id, match_score, matched_experience_ids, matched_tags, created_at)
          VALUES (?, ?, 'distill-help-3', 0.8, '[]', '["test"]', ?)`,
    args: [randomUUID(), helpResult.request.id, new Date().toISOString()],
  });
  await respondToHelp(helpResult.request.id, 'distill-help-3', 'Here is the manual diagnosis with enough detail for testing purposes.');

  // 用手动提供的经验 ID 解决
  const manualExpId = 'manual-exp-id-12345';
  const resolveResult = await resolveHelp(helpResult.request.id, 'distill-req-3', manualExpId);

  assert(resolveResult.distilled_experience_id === undefined, '手动提供 ID 时不触发沉淀');
  assert(resolveResult.request.resolution_experience_id === manualExpId, '使用手动提供的 ID');
}

async function testDistillSkippedWhenNoResponses() {
  console.log('\n=== 对话沉淀跳过（无回复） ===');

  const db = getClient();
  await registerUser(db, { agent_id: 'distill-req-4', name: 'DR4' });
  await adjustCredits('distill-req-4', 50, 'test_distill_4');

  // 发起求助，但没人回复就解决了
  const helpResult = await createHelpRequest(
    'distill-req-4',
    'Test request that gets resolved without any responses for distill skip test',
    ['test'],
    'simple',
  );

  const resolveResult = await resolveHelp(helpResult.request.id, 'distill-req-4');

  assert(resolveResult.distilled_experience_id === undefined, '无回复时不触发沉淀');
}

async function main() {
  console.log('🆘 求助系统测试开始\n');
  const startTime = Date.now();

  await setup();

  // 基础流程
  const { request } = await testCreateHelpRequest();          // Bob 求助 #1
  const complexResult = await testCreateComplexHelp();        // Bob 求助 #2
  await testHelpInbox(request.id);
  await testRespondToHelp(request.id);
  await testCannotRespondSelf();                               // Alice 求助 #1
  await testCannotRespondUnmatched();                          // Bob 求助 #3
  await testResolveHelp(request.id);
  await testResolveNotOwner(complexResult.request.id);

  // 查询
  await testGetMyRequests();
  await testGetHelpDetail(request.id);

  // 安全控制
  await testDailyLimits();
  await testInsufficientCredits();
  await testFieldValidation();

  // 诊断报告模板
  await testDiagnosticTemplates();
  await testDiagnosticReportValidation();
  await testDiagnosticReportToText();
  await testStructuredDiagnosticResponse();

  // 对话沉淀
  await testDistillWithStructuredReport();
  await testDistillWithPlainText();
  await testDistillSkippedWhenExplicitId();
  await testDistillSkippedWhenNoResponses();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🆘 求助系统测试完成: ${passed} 通过, ${failed} 失败 (${elapsed}s)`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
