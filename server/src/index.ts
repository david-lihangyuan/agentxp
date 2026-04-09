/**
 * Serendip Experience Network — API Server
 * Hono + libSQL + OpenAI Embedding
 *
 * 支持 SQLite 本地文件（开发）和 Turso 远程数据库（生产）
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { initDB, getClient, insertExperience, insertExecutables, getExperience, insertVerification, getVerificationSummary, getAgentByKey, getNetworkStats } from './db.js';
import { initEmbedding, getEmbedding, experienceToText } from './embedding.js';
import { search } from './search.js';
import { registerUser, listUserKeys, revokeApiKey } from './shared-auth.js';
import { autoSeedIfEmpty } from './demo-seed.js';
import { createRateLimiter, API_RATE_LIMIT, REGISTER_RATE_LIMIT, SEARCH_RATE_LIMIT } from './shared-rate-limit.js';
import type { Experience, ExecutableContent, ExecutableType, PublishResponse, SearchRequest, VerifyRequest, VerifyResponse } from './types.js';
import { getNetworkHealth } from './network-health.js';

type Env = { Variables: { agentId: string } };
const app = new Hono<Env>();

// === Rate Limiting ===
const registerLimiter = createRateLimiter(REGISTER_RATE_LIMIT);
const apiLimiter = createRateLimiter(API_RATE_LIMIT);
const searchLimiter = createRateLimiter(SEARCH_RATE_LIMIT);

// === 用户注册（无需鉴权） ===
app.post('/register', registerLimiter, async (c) => {
  try {
    const body = await c.req.json();
    if (!body.agent_id) {
      return c.json({ error: '缺少 agent_id 字段' }, 400);
    }
    const result = await registerUser(getClient(), {
      agent_id: body.agent_id,
      name: body.name,
    });
    return c.json(result, result.status === 'created' ? 201 : 200);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// === 鉴权中间件 ===
app.use('/api/*', apiLimiter);
app.use('/api/*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: '缺少 Authorization header' }, 401);
  }
  const key = authHeader.slice(7);
  const agentId = await getAgentByKey(key);
  if (!agentId) {
    return c.json({ error: '无效的 API key' }, 401);
  }
  c.set('agentId', agentId);
  await next();
});

// === 健康检查 ===
app.get('/', (c) => {
  return c.json({
    name: 'Serendip Experience Network',
    version: '0.2.0',
    protocol: 'serendip-experience/0.1',
    status: 'running',
  });
});

app.get('/health', async (c) => {
  try {
    const client = getClient();
    await client.execute('SELECT 1');
    return c.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
  } catch (err: any) {
    return c.json({ status: 'error', db: 'disconnected', error: err.message }, 503);
  }
});

// === 网络统计（公开端点，不需鉴权） ===
app.get('/stats', async (c) => {
  try {
    const report = await getNetworkHealth();
    return c.json(report);
  } catch (err: any) {
    console.error('Stats 错误:', err);
    return c.json({ error: err.message || 'Internal Server Error' }, 500);
  }
});

// === publish ===
app.post('/api/publish', async (c) => {
  try {
    const body = await c.req.json();
    const exp = body.experience as Experience;

    // 基础校验
    if (!exp?.core?.what || !exp?.core?.tried || !exp?.core?.learned) {
      return c.json({ error: '缺少必填字段：core.what, core.tried, core.learned' }, 400);
    }

    // 字段长度校验（SPEC 限制）
    const lengthChecks = [
      { field: 'core.what', value: exp.core.what, max: 100 },
      { field: 'core.context', value: exp.core.context, max: 300 },
      { field: 'core.tried', value: exp.core.tried, max: 500 },
      { field: 'core.outcome_detail', value: exp.core.outcome_detail, max: 500 },
      { field: 'core.learned', value: exp.core.learned, max: 500 },
    ];
    for (const check of lengthChecks) {
      if (check.value && check.value.length > check.max) {
        return c.json({ error: `${check.field} 超过长度限制（最多 ${check.max} 字符，实际 ${check.value.length}）` }, 400);
      }
    }

    // outcome 合法值校验（避免 DB CHECK 约束返回 500）
    if (exp.core.outcome && !['succeeded', 'failed', 'partial', 'inconclusive'].includes(exp.core.outcome)) {
      return c.json({ error: `outcome 必须是 succeeded/failed/partial/inconclusive 之一` }, 400);
    }

    // tags 数量限制
    if (exp.tags && exp.tags.length > 20) {
      return c.json({ error: 'tags 最多 20 个' }, 400);
    }

    // 生成 embedding
    const text = experienceToText({
      what: exp.core.what,
      context: exp.core.context || '',
      tried: exp.core.tried,
      learned: exp.core.learned,
      tags: exp.tags || [],
    });

    let embedding: Float32Array | null = null;
    try {
      embedding = await getEmbedding(text);
    } catch (err) {
      console.error('Embedding 生成失败，继续保存但不索引:', err);
    }

    // 设置 publisher（确保必填字段有默认值）
    const agentId = c.get('agentId');
    exp.publisher = exp.publisher || {} as any;
    exp.publisher.agent_id = agentId;
    exp.publisher.platform = exp.publisher.platform || 'unknown';
    exp.core.context = exp.core.context || '';
    // outcome 默认值必须匹配 DB CHECK 约束
    exp.core.outcome = exp.core.outcome || 'inconclusive';
    exp.core.outcome_detail = exp.core.outcome_detail || '';

    const id = await insertExperience(exp, embedding);

    // v0.2: 存储可执行内容
    if (exp.executable && Array.isArray(exp.executable) && exp.executable.length > 0) {
      // 校验
      if (exp.executable.length > 3) {
        return c.json({ error: 'executable 最多 3 个片段' }, 400);
      }
      const validTypes: ExecutableType[] = ['snippet', 'config', 'command', 'test'];
      for (const exec of exp.executable) {
        if (!validTypes.includes(exec.type)) {
          return c.json({ error: `executable.type 必须是 ${validTypes.join('/')} 之一` }, 400);
        }
        if (!exec.language || !exec.code || !exec.description) {
          return c.json({ error: 'executable 缺少必填字段：language, code, description' }, 400);
        }
        if (exec.code.length > 2000) {
          return c.json({ error: `executable.code 超过长度限制（最多 2000 字符，实际 ${exec.code.length}）` }, 400);
        }
        if (exec.description.length > 200) {
          return c.json({ error: `executable.description 超过长度限制（最多 200 字符）` }, 400);
        }
      }
      await insertExecutables(id, exp.executable);
    }

    const response: PublishResponse = {
      status: 'published',
      experience_id: id,
      indexed_tags: exp.tags || [],
      published_at: exp.published_at || new Date().toISOString(),
    };

    return c.json(response, 201);
  } catch (err: any) {
    console.error('Publish 错误:', err);
    return c.json({ error: err.message || 'Internal Server Error' }, 500);
  }
});

// === search ===
app.post('/api/search', searchLimiter, async (c) => {
  try {
    const body = await c.req.json() as SearchRequest;

    if (!body.query) {
      return c.json({ error: '缺少 query 字段' }, 400);
    }

    // limit 上界检查（SPEC: 最大 50）
    if (body.limit !== undefined) {
      body.limit = Math.min(Math.max(1, body.limit), 50);
    }

    const results = await search(body);
    return c.json(results);
  } catch (err: any) {
    console.error('Search 错误:', err);
    return c.json({ error: err.message || 'Internal Server Error' }, 500);
  }
});

// === verify ===
app.post('/api/verify', async (c) => {
  try {
    const body = await c.req.json() as VerifyRequest;

    if (!body.experience_id || !body.result) {
      return c.json({ error: '缺少 experience_id 或 result' }, 400);
    }

    // result 合法值校验
    const validResults = ['confirmed', 'denied', 'conditional'];
    if (!validResults.includes(body.result)) {
      return c.json({ error: `result 必须是 ${validResults.join('/')} 之一` }, 400);
    }

    // 检查经验存在
    const exp = await getExperience(body.experience_id);
    if (!exp) {
      return c.json({ error: '经验不存在' }, 404);
    }

    // 不能验证自己
    const agentId = c.get('agentId');
    if (exp.publisher.agent_id === agentId) {
      return c.json({ error: '不能验证自己的经验' }, 403);
    }

    const verificationId = await insertVerification(
      body.experience_id,
      agentId,
      body.verifier?.platform || 'unknown',
      body.result,
      body.conditions,
      body.notes,
    );

    const summary = await getVerificationSummary(body.experience_id);

    const response: VerifyResponse = {
      status: 'recorded',
      verification_id: verificationId,
      experience_verification_summary: summary,
    };

    return c.json(response);
  } catch (err: any) {
    console.error('Verify 错误:', err);
    return c.json({ error: err.message || 'Internal Server Error' }, 500);
  }
});

// === 单条查询 ===
app.get('/api/experiences/:id', async (c) => {
  try {
    const exp = await getExperience(c.req.param('id'));
    if (!exp) return c.json({ error: '经验不存在' }, 404);
    const summary = await getVerificationSummary(exp.id);
    return c.json({ experience: exp, verification_summary: summary });
  } catch (err: any) {
    console.error('GetExperience 错误:', err);
    return c.json({ error: err.message || 'Internal Server Error' }, 500);
  }
});

// === 用户 key 管理（需鉴权） ===
app.get('/api/keys', async (c) => {
  const agentId = c.get('agentId');
  const keys = await listUserKeys(getClient(), agentId);
  return c.json({ agent_id: agentId, keys });
});

app.delete('/api/keys/:key', async (c) => {
  const agentId = c.get('agentId');
  const key = c.req.param('key');
  const ok = await revokeApiKey(getClient(), agentId, key);
  if (!ok) return c.json({ error: 'Key 不存在或不属于你' }, 404);
  return c.json({ status: 'revoked' });
});

// === 启动 ===
const PORT = parseInt(process.env.PORT || '3141');
const DB_URL = process.env.DB_URL || 'file:./data/experiences.db';
const DB_AUTH_TOKEN = process.env.DB_AUTH_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE = process.env.OPENAI_BASE_URL;
const MOCK_EMBEDDINGS = process.env.MOCK_EMBEDDINGS === 'true';

if (!OPENAI_KEY && !MOCK_EMBEDDINGS) {
  console.error('❌ 请设置 OPENAI_API_KEY 环境变量（或用 MOCK_EMBEDDINGS=true 测试）');
  process.exit(1);
}

async function start() {
  await initDB(DB_URL, DB_AUTH_TOKEN);
  initEmbedding(OPENAI_KEY || 'mock', OPENAI_BASE, MOCK_EMBEDDINGS);

  if (MOCK_EMBEDDINGS) {
    console.log('⚠️  Mock 模式：embedding 使用伪随机向量，语义搜索无效');
  }

  // 空库自动填充种子数据
  await autoSeedIfEmpty();

  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`🦞 Serendip Experience Network 运行中 — http://localhost:${PORT}`);
    console.log(`   版本: 0.2.0（libSQL 数据库）`);
    console.log(`   数据库: ${DB_URL}`);
  });
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
