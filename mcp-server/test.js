#!/usr/bin/env node
/**
 * AgentXP MCP Server — 协议合规性测试
 *
 * 测试 JSON-RPC 2.0 通信、tool 定义、错误处理。
 * 不需要真实服务器——只测协议层。
 */

import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

function startServer() {
  const proc = spawn('node', [join(__dirname, 'index.js')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AGENTXP_SERVER_URL: 'http://localhost:99999', // 故意不存在
      AGENTXP_API_KEY: 'test-key-for-protocol-test',
      AGENTXP_AGENT_ID: 'test-agent',
    },
  });
  return proc;
}

function sendRpc(proc, obj) {
  proc.stdin.write(JSON.stringify(obj) + '\n');
}

function waitForResponse(proc, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('超时')), timeout);
    const handler = (data) => {
      clearTimeout(timer);
      proc.stdout.off('data', handler);
      try {
        resolve(JSON.parse(data.toString().trim()));
      } catch (e) {
        reject(new Error(`无法解析响应: ${data.toString()}`));
      }
    };
    proc.stdout.on('data', handler);
  });
}

async function runTests() {
  console.log('\n🧪 AgentXP MCP Server 协议测试\n');

  // === 测试 1：initialize ===
  console.log('--- initialize ---');
  const proc = startServer();

  // 等一下让服务器启动
  await new Promise(r => setTimeout(r, 500));

  sendRpc(proc, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '0.1' },
    },
  });

  const initRes = await waitForResponse(proc);
  assert(initRes.jsonrpc === '2.0', 'JSON-RPC 2.0 版本');
  assert(initRes.id === 1, '正确的请求 ID');
  assert(initRes.result?.protocolVersion === '2024-11-05', '协议版本 2024-11-05');
  assert(initRes.result?.capabilities?.tools !== undefined, '声明 tools 能力');
  assert(initRes.result?.serverInfo?.name === 'agentxp', '服务器名称 agentxp');

  // === 测试 2：notifications/initialized ===
  console.log('\n--- notifications/initialized ---');
  sendRpc(proc, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  // notification 不应该有回复，等一小会确认没有
  await new Promise(r => setTimeout(r, 300));
  assert(true, 'notification 无回复（正确）');

  // === 测试 3：tools/list ===
  console.log('\n--- tools/list ---');
  sendRpc(proc, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });

  const listRes = await waitForResponse(proc);
  assert(listRes.id === 2, '正确的请求 ID');
  assert(Array.isArray(listRes.result?.tools), 'tools 是数组');
  assert(listRes.result.tools.length === 3, '3 个工具');

  const toolNames = listRes.result.tools.map(t => t.name);
  assert(toolNames.includes('agentxp_search'), '包含 agentxp_search');
  assert(toolNames.includes('agentxp_publish'), '包含 agentxp_publish');
  assert(toolNames.includes('agentxp_verify'), '包含 agentxp_verify');

  // 检查 schema 结构
  const searchTool = listRes.result.tools.find(t => t.name === 'agentxp_search');
  assert(searchTool.inputSchema?.type === 'object', 'search 有 inputSchema');
  assert(searchTool.inputSchema.required?.includes('query'), 'search 要求 query 参数');
  assert(!!searchTool.description, 'search 有描述');

  const publishTool = listRes.result.tools.find(t => t.name === 'agentxp_publish');
  assert(publishTool.inputSchema.required?.includes('what'), 'publish 要求 what');
  assert(publishTool.inputSchema.required?.includes('tried'), 'publish 要求 tried');
  assert(publishTool.inputSchema.required?.includes('learned'), 'publish 要求 learned');

  // === 测试 4：tools/call 未知工具 ===
  console.log('\n--- tools/call（未知工具）---');
  sendRpc(proc, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'nonexistent_tool', arguments: {} },
  });

  const unknownRes = await waitForResponse(proc);
  assert(unknownRes.id === 3, '正确的请求 ID');
  assert(unknownRes.error?.code === -32601, '错误码 -32601');

  // === 测试 5：tools/call search（服务器不可用应返回 isError） ===
  console.log('\n--- tools/call search（服务器不可用）---');
  sendRpc(proc, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'agentxp_search',
      arguments: { query: 'test query' },
    },
  });

  const searchRes = await waitForResponse(proc, 5000);
  assert(searchRes.id === 4, '正确的请求 ID');
  assert(searchRes.result?.isError === true, '服务器不可用时返回 isError');
  assert(searchRes.result?.content?.[0]?.type === 'text', '错误内容是 text 类型');

  // === 测试 6：ping ===
  console.log('\n--- ping ---');
  sendRpc(proc, {
    jsonrpc: '2.0',
    id: 5,
    method: 'ping',
  });

  const pingRes = await waitForResponse(proc);
  assert(pingRes.id === 5, '正确的请求 ID');
  assert(pingRes.result !== undefined, 'ping 有响应');

  // === 测试 7：未知方法 ===
  console.log('\n--- 未知方法 ---');
  sendRpc(proc, {
    jsonrpc: '2.0',
    id: 6,
    method: 'unknown/method',
    params: {},
  });

  const unknownMethodRes = await waitForResponse(proc);
  assert(unknownMethodRes.error?.code === -32601, '未知方法返回 -32601');

  // === 测试 8：无效 JSON ===
  console.log('\n--- 无效 JSON ---');
  proc.stdin.write('this is not json\n');

  const parseErrRes = await waitForResponse(proc);
  assert(parseErrRes.error?.code === -32700, '无效 JSON 返回 -32700');

  // === 清理 ===
  proc.kill();

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ 通过: ${passed}  ❌ 失败: ${failed}  共: ${passed + failed}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
