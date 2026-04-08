/**
 * Serendip Experience Network — API Server
 * Hono + libSQL + OpenAI Embedding
 *
 * 支持 SQLite 本地文件（开发）和 Turso 远程数据库（生产）
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { initDB, getClient, insertExperience, getExperience, insertVerification, getVerificationSummary, getAgentByKey } from './db.js';
import { initEmbedding, getEmbedding, experienceToText } from './embedding.js';
import { search } from './search.js';
import { registerUser, listUserKeys, revokeApiKey } from './shared-auth.js';
import { autoSeedIfEmpty } from './demo-seed.js';
import { createRateLimiter, API_RATE_LIMIT, REGISTER_RATE_LIMIT, SEARCH_RATE_LIMIT } from './shared-rate-limit.js';
import type { Experience, PublishResponse, SearchRequest, VerifyRequest, VerifyResponse } from './types.js';

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

// === publish ===
app.post('/api/publish', async (c) => {
  const body = await c.req.json();
  const exp = body.experience as Experience;

  // 基础校验
  if (!exp?.core?.what || !exp?.core?.tried || !exp?.core?.learned) {
    return c.json({ error: '缺少必填字段：core.what, core.tried, core.learned' }, 400);
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

  // 设置 publisher
  const agentId = c.get('agentId');
  exp.publisher = exp.publisher || {} as any;
  exp.publisher.agent_id = agentId;

  const id = await insertExperience(exp, embedding);

  const response: PublishResponse = {
    status: 'published',
    experience_id: id,
    indexed_tags: exp.tags || [],
    published_at: exp.published_at || new Date().toISOString(),
  };

  return c.json(response, 201);
});

// === search ===
app.post('/api/search', searchLimiter, async (c) => {
  const body = await c.req.json() as SearchRequest;

  if (!body.query) {
    return c.json({ error: '缺少 query 字段' }, 400);
  }

  const results = await search(body);
  return c.json(results);
});

// === verify ===
app.post('/api/verify', async (c) => {
  const body = await c.req.json() as VerifyRequest;

  if (!body.experience_id || !body.result) {
    return c.json({ error: '缺少 experience_id 或 result' }, 400);
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
});

// === 单条查询 ===
app.get('/api/experiences/:id', async (c) => {
  const exp = await getExperience(c.req.param('id'));
  if (!exp) return c.json({ error: '经验不存在' }, 404);
  const summary = await getVerificationSummary(exp.id);
  return c.json({ experience: exp, verification_summary: summary });
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
