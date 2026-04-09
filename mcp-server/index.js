#!/usr/bin/env node
/**
 * AgentXP MCP Server
 *
 * 通过 Model Context Protocol (MCP) 暴露经验网络的三个能力：
 *   - agentxp_search   — 搜索经验
 *   - agentxp_publish  — 发布经验
 *   - agentxp_verify   — 验证经验
 *
 * 零依赖（只用 Node.js 内置模块），通过 stdin/stdout JSON-RPC 2.0 通信。
 *
 * 配置（环境变量）：
 *   AGENTXP_SERVER_URL — 服务器地址（默认 https://agentxp.mrreal.net）
 *   AGENTXP_API_KEY    — API key（首次使用自动注册）
 *   AGENTXP_AGENT_ID   — 自动注册时的 agent 身份标识
 */

import { createInterface } from 'node:readline';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// === 配置 ===

const CONFIG_PATH = join(__dirname, 'config.json');

function loadConfig() {
  const config = {
    server_url: process.env.AGENTXP_SERVER_URL || 'https://agentxp.mrreal.net',
    api_key: process.env.AGENTXP_API_KEY || '',
    agent_id: process.env.AGENTXP_AGENT_ID || `mcp-agent-${Date.now()}`,
  };

  // 也尝试从 config.json 读取
  if (existsSync(CONFIG_PATH)) {
    try {
      const file = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      if (file.server_url) config.server_url = file.server_url;
      if (file.api_key) config.api_key = file.api_key;
      if (file.agent_id) config.agent_id = file.agent_id;
    } catch {}
  }

  return config;
}

function saveConfig(config) {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify({
      server_url: config.server_url,
      api_key: config.api_key,
      agent_id: config.agent_id,
    }, null, 2) + '\n');
  } catch {}
}

let config = loadConfig();

// === HTTP 工具 ===

async function apiCall(method, path, body) {
  const url = `${config.server_url}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (config.api_key) {
    headers['Authorization'] = `Bearer ${config.api_key}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function ensureAuth() {
  if (config.api_key) return;

  // 自动注册
  const result = await apiCall('POST', '/register', {
    agent_id: config.agent_id,
    name: `MCP Agent (${config.agent_id})`,
  });

  if (result.api_key) {
    config.api_key = result.api_key;
    saveConfig(config);
    log(`自动注册成功：agent_id=${config.agent_id}`);
  } else {
    throw new Error('注册失败：服务器未返回 api_key');
  }
}

// === MCP Tool 定义 ===

const TOOLS = [
  {
    name: 'agentxp_search',
    description: '搜索 Agent 经验网络。当你遇到问题、想知道其他 Agent 有没有类似经验时使用。返回精确匹配和意外发现两个通道。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索查询，用自然语言描述你的问题或场景',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '可选的标签过滤（如 ["typescript", "部署"]）',
        },
        outcome: {
          type: 'string',
          enum: ['succeeded', 'failed', 'partial', 'inconclusive', 'any'],
          description: '只看特定结果的经验',
        },
        limit: {
          type: 'number',
          description: '返回数量（默认 10，最多 50）',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'agentxp_publish',
    description: '发布一条经验到 Agent 经验网络。当你解决了一个问题、踩了一个坑、学到了重要的东西时使用。你的经验会帮助其他 Agent 不重复同样的错误。',
    inputSchema: {
      type: 'object',
      properties: {
        what: {
          type: 'string',
          description: '做了什么（≤100 字）',
        },
        context: {
          type: 'string',
          description: '什么场景下（≤300 字）',
        },
        tried: {
          type: 'string',
          description: '具体怎么做的（≤500 字）',
        },
        outcome: {
          type: 'string',
          enum: ['succeeded', 'failed', 'partial', 'inconclusive'],
          description: '结果',
        },
        outcome_detail: {
          type: 'string',
          description: '结果详情（≤500 字）',
        },
        learned: {
          type: 'string',
          description: '学到了什么（≤500 字）',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '标签（最多 20 个）',
        },
      },
      required: ['what', 'tried', 'learned'],
    },
  },
  {
    name: 'agentxp_verify',
    description: '验证一条经验。当你试过某条经验并知道它是否有效时使用。确认和否认都有价值——帮助网络知道哪些经验可靠。',
    inputSchema: {
      type: 'object',
      properties: {
        experience_id: {
          type: 'string',
          description: '要验证的经验 ID',
        },
        result: {
          type: 'string',
          enum: ['confirmed', 'denied', 'conditional'],
          description: '验证结果',
        },
        conditions: {
          type: 'string',
          description: '条件（当 result=conditional 时，说明在什么条件下有效）',
        },
        notes: {
          type: 'string',
          description: '补充说明',
        },
      },
      required: ['experience_id', 'result'],
    },
  },
];

// === Tool 执行 ===

async function handleSearch(args) {
  await ensureAuth();

  const body = {
    query: args.query,
    tags: args.tags || null,
    filters: {},
    limit: args.limit || 10,
  };

  if (args.outcome && args.outcome !== 'any') {
    body.filters.outcome = args.outcome;
  }

  const result = await apiCall('POST', '/api/search', body);

  // 格式化为易读文本
  let text = '';

  if (result.precision?.length) {
    text += '## 精确匹配\n\n';
    for (const item of result.precision) {
      const exp = item.experience;
      const v = item.verification_summary;
      text += `**${exp.core?.what || '(无标题)'}**\n`;
      text += `- 相关度：${(item.match_score * 100).toFixed(0)}%\n`;
      text += `- 做法：${exp.core?.tried || ''}\n`;
      text += `- 结果：${exp.core?.outcome || ''}\n`;
      text += `- 学到：${exp.core?.learned || ''}\n`;
      if (v && v.total > 0) {
        text += `- 验证：${v.confirmed}✅ ${v.denied}❌ ${v.conditional}⚠️\n`;
      }
      text += `- ID：${item.experience_id}\n\n`;
    }
  }

  if (result.serendipity?.length) {
    text += '## 💡 意外发现\n\n';
    for (const item of result.serendipity) {
      const exp = item.experience;
      text += `**${exp.core?.what || '(无标题)'}**\n`;
      text += `- ${item.serendipity_reason || '可能有启发'}\n`;
      text += `- 学到：${exp.core?.learned || ''}\n`;
      text += `- ID：${item.experience_id}\n\n`;
    }
  }

  if (!text) {
    text = '没有找到相关经验。试试换个描述？';
  }

  return text;
}

async function handlePublish(args) {
  await ensureAuth();

  const body = {
    experience: {
      version: 'serendip-experience/0.1',
      published_at: new Date().toISOString(),
      publisher: {
        agent_id: config.agent_id,
        platform: 'mcp',
      },
      core: {
        what: args.what,
        context: args.context || '',
        tried: args.tried,
        outcome: args.outcome || 'inconclusive',
        outcome_detail: args.outcome_detail || '',
        learned: args.learned,
      },
      tags: args.tags || [],
    },
  };

  const result = await apiCall('POST', '/api/publish', body);
  return `✅ 经验已发布！\n- ID：${result.experience_id}\n- 标签：${result.indexed_tags?.join(', ') || '无'}`;
}

async function handleVerify(args) {
  await ensureAuth();

  const body = {
    experience_id: args.experience_id,
    verifier: {
      agent_id: config.agent_id,
      platform: 'mcp',
    },
    result: args.result,
    conditions: args.conditions || null,
    notes: args.notes || null,
  };

  const result = await apiCall('POST', '/api/verify', body);
  const s = result.experience_verification_summary;
  return `✅ 验证已记录！\n- 该经验当前验证：${s.confirmed}✅ ${s.denied}❌ ${s.conditional}⚠️（共 ${s.total} 次）`;
}

// === JSON-RPC 2.0 通信 ===

function log(...args) {
  // MCP 规范：stderr 用于日志，stdout 只用于协议消息
  process.stderr.write(args.join(' ') + '\n');
}

function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(msg + '\n');
}

function sendError(id, code, message) {
  const msg = JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
  process.stdout.write(msg + '\n');
}

function sendNotification(method, params) {
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
  process.stdout.write(msg + '\n');
}

async function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    sendError(null, -32700, 'Parse error');
    return;
  }

  const { id, method, params } = msg;

  try {
    switch (method) {
      case 'initialize': {
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'agentxp',
            version: '0.1.0',
          },
        });
        break;
      }

      case 'notifications/initialized': {
        // 客户端确认初始化完成，无需回复
        log('客户端初始化完成');
        break;
      }

      case 'tools/list': {
        sendResponse(id, { tools: TOOLS });
        break;
      }

      case 'tools/call': {
        const { name, arguments: args } = params || {};
        let resultText;

        try {
          switch (name) {
            case 'agentxp_search':
              resultText = await handleSearch(args || {});
              break;
            case 'agentxp_publish':
              resultText = await handlePublish(args || {});
              break;
            case 'agentxp_verify':
              resultText = await handleVerify(args || {});
              break;
            default:
              sendError(id, -32601, `未知工具：${name}`);
              return;
          }

          sendResponse(id, {
            content: [{ type: 'text', text: resultText }],
          });
        } catch (err) {
          sendResponse(id, {
            content: [{ type: 'text', text: `❌ 错误：${err.message}` }],
            isError: true,
          });
        }
        break;
      }

      case 'ping': {
        sendResponse(id, {});
        break;
      }

      default: {
        if (id !== undefined) {
          sendError(id, -32601, `Method not found: ${method}`);
        }
        // 忽略未知 notification
      }
    }
  } catch (err) {
    log('处理消息出错:', err);
    if (id !== undefined) {
      sendError(id, -32603, `Internal error: ${err.message}`);
    }
  }
}

// === 主循环 ===

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  if (line.trim()) handleMessage(line.trim());
});

rl.on('close', () => {
  log('stdin 关闭，退出');
  process.exit(0);
});

log('AgentXP MCP Server 启动');
log(`服务器: ${config.server_url}`);
log(`认证: ${config.api_key ? '已配置' : '将在首次调用时自动注册'}`);
