/**
 * Rate Limiting 集成测试
 *
 * MOCK_EMBEDDINGS=true npx tsx src/test-rate-limit.ts
 */

import { Hono } from 'hono';
import { createRateLimiter } from './shared-rate-limit.js';

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

/**
 * 辅助：发请求到 Hono app
 */
async function request(app: Hono, path: string, opts?: RequestInit) {
  const req = new Request(`http://localhost${path}`, opts);
  return app.fetch(req);
}

async function run() {
  console.log('\n--- 1. 基本限流：达到上限后返回 429 ---');
  {
    const app = new Hono();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    app.use('/*', limiter);
    app.get('/test', (c) => c.json({ ok: true }));

    // 前 3 次正常
    for (let i = 0; i < 3; i++) {
      const res = await request(app, '/test');
      assert(res.status === 200, `第 ${i + 1} 次请求返回 200`);
      assert(res.headers.get('X-RateLimit-Limit') === '3', `X-RateLimit-Limit = 3`);
      const remaining = res.headers.get('X-RateLimit-Remaining');
      assert(remaining === String(2 - i), `X-RateLimit-Remaining = ${2 - i}（实际: ${remaining}）`);
    }

    // 第 4 次被限流
    const res4 = await request(app, '/test');
    assert(res4.status === 429, `第 4 次请求返回 429`);
    const body4 = await res4.json() as any;
    assert(body4.error?.includes('频繁'), `错误消息包含"频繁"（实际: ${body4.error}）`);
    assert(res4.headers.has('Retry-After'), `有 Retry-After header`);
    assert(res4.headers.get('X-RateLimit-Remaining') === '0', `Remaining = 0`);
  }

  console.log('\n--- 2. 不同 key 独立限流 ---');
  {
    const app = new Hono();

    // 模拟鉴权（用自定义 keyExtractor 代替 agentId 变量避免类型问题）
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 2,
      keyExtractor: (c) => `agent:${c.req.header('X-Agent') || 'unknown'}`,
    });
    app.use('/*', limiter);
    app.get('/test', (c) => c.json({ ok: true }));

    // agent-a 用 2 次
    for (let i = 0; i < 2; i++) {
      const res = await request(app, '/test', { headers: { 'X-Agent': 'agent-a' } });
      assert(res.status === 200, `agent-a 第 ${i + 1} 次返回 200`);
    }

    // agent-a 第 3 次被限
    const resA = await request(app, '/test', { headers: { 'X-Agent': 'agent-a' } });
    assert(resA.status === 429, `agent-a 第 3 次被限流`);

    // agent-b 仍然可用
    const resB = await request(app, '/test', { headers: { 'X-Agent': 'agent-b' } });
    assert(resB.status === 200, `agent-b 不受 agent-a 限流影响`);
  }

  console.log('\n--- 3. 滑动窗口过期后恢复 ---');
  {
    const app = new Hono();
    // 极短窗口用于测试
    const limiter = createRateLimiter({ windowMs: 200, max: 2 });
    app.use('/*', limiter);
    app.get('/test', (c) => c.json({ ok: true }));

    // 用完 2 次
    await request(app, '/test');
    await request(app, '/test');

    // 被限
    const res1 = await request(app, '/test');
    assert(res1.status === 429, `窗口满后被限流`);

    // 等窗口过期
    await new Promise(r => setTimeout(r, 250));

    // 恢复
    const res2 = await request(app, '/test');
    assert(res2.status === 200, `窗口过期后恢复正常`);
  }

  console.log('\n--- 4. skip 函数 ---');
  {
    const app = new Hono();
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      skip: (c) => c.req.header('X-Admin') === 'true',
    });
    app.use('/*', limiter);
    app.get('/test', (c) => c.json({ ok: true }));

    // 普通用户用完 1 次
    const res1 = await request(app, '/test');
    assert(res1.status === 200, `普通用户第 1 次 200`);

    const res2 = await request(app, '/test');
    assert(res2.status === 429, `普通用户第 2 次 429`);

    // admin 跳过限流
    const resAdmin = await request(app, '/test', { headers: { 'X-Admin': 'true' } });
    assert(resAdmin.status === 200, `admin 跳过限流`);
  }

  console.log('\n--- 5. 自定义错误消息 ---');
  {
    const app = new Hono();
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      message: '自定义限流消息',
    });
    app.use('/*', limiter);
    app.get('/test', (c) => c.json({ ok: true }));

    await request(app, '/test');
    const res = await request(app, '/test');
    assert(res.status === 429, `返回 429`);
    const body = await res.json() as any;
    assert(body.error === '自定义限流消息', `自定义消息正确（实际: ${body.error}）`);
  }

  console.log('\n--- 6. 自定义 keyExtractor ---');
  {
    const app = new Hono();
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 2,
      keyExtractor: (c) => c.req.header('X-Custom-Key') || 'default',
    });
    app.use('/*', limiter);
    app.get('/test', (c) => c.json({ ok: true }));

    // key-1 用完
    await request(app, '/test', { headers: { 'X-Custom-Key': 'key-1' } });
    await request(app, '/test', { headers: { 'X-Custom-Key': 'key-1' } });
    const res1 = await request(app, '/test', { headers: { 'X-Custom-Key': 'key-1' } });
    assert(res1.status === 429, `key-1 被限`);

    // key-2 不受影响
    const res2 = await request(app, '/test', { headers: { 'X-Custom-Key': 'key-2' } });
    assert(res2.status === 200, `key-2 正常`);
  }

  console.log('\n--- 7. Retry-After header 合理 ---');
  {
    const app = new Hono();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    app.use('/*', limiter);
    app.get('/test', (c) => c.json({ ok: true }));

    await request(app, '/test');
    const res = await request(app, '/test');
    assert(res.status === 429, `429 状态`);

    const retryAfter = parseInt(res.headers.get('Retry-After') || '0');
    assert(retryAfter > 0 && retryAfter <= 60, `Retry-After 在合理范围 1-60（实际: ${retryAfter}）`);
  }

  console.log('\n--- 8. X-RateLimit-Reset 是 Unix 时间戳 ---');
  {
    const app = new Hono();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 5 });
    app.use('/*', limiter);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await request(app, '/test');
    const reset = parseInt(res.headers.get('X-RateLimit-Reset') || '0');
    const nowSec = Math.floor(Date.now() / 1000);
    assert(reset > nowSec, `Reset 时间在未来（reset=${reset}, now=${nowSec}）`);
    assert(reset - nowSec <= 61, `Reset 时间在 1 分钟内`);
  }

  console.log(`\n========================================`);
  console.log(`🏁 Rate Limiting 测试: ${passed} 通过, ${failed} 失败`);
  console.log(`========================================`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
