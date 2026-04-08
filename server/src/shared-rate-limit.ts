/**
 * Serendip 协议 — 通用 Rate Limiting 中间件
 *
 * 内存计数器实现，滑动窗口。生产环境可升级 Redis。
 * 两个场景共用。
 *
 * 用法：
 *   import { createRateLimiter } from './shared-rate-limit.js';
 *   const limiter = createRateLimiter({ windowMs: 60_000, max: 60 });
 *   app.use('/api/*', limiter);
 *
 * 限流时返回 429 + Retry-After header + JSON body。
 * 每次响应附带 X-RateLimit-* headers，方便客户端自适应。
 */

import type { Context, Next, MiddlewareHandler } from 'hono';

// === 配置 ===

export interface RateLimitConfig {
  /** 窗口大小（毫秒），默认 60000（1 分钟） */
  windowMs?: number;
  /** 窗口内最大请求数，默认 60 */
  max?: number;
  /** 提取限流 key 的函数。默认用 agentId（鉴权后）或 IP */
  keyExtractor?: (c: Context) => string;
  /** 自定义限流消息 */
  message?: string;
  /** 跳过限流的判断函数（如管理员白名单） */
  skip?: (c: Context) => boolean;
}

// === 内部数据结构 ===

interface WindowEntry {
  /** 当前窗口内的请求时间戳列表 */
  timestamps: number[];
}

// === 核心实现 ===

/**
 * 创建 rate limiting 中间件（滑动窗口算法）。
 *
 * 滑动窗口比固定窗口更平滑：
 * - 固定窗口在窗口边界可能出现 2x burst
 * - 滑动窗口始终精确统计"过去 N 毫秒内"的请求数
 *
 * 内存开销：每个 key 存一个时间戳数组，长度 ≤ max。
 * 定期清理不活跃的 key（防内存泄漏）。
 */
export function createRateLimiter(config: RateLimitConfig = {}): MiddlewareHandler {
  const {
    windowMs = 60_000,
    max = 60,
    keyExtractor = defaultKeyExtractor,
    message = '请求过于频繁，请稍后再试',
    skip,
  } = config;

  /** key → 窗口条目 */
  const store = new Map<string, WindowEntry>();

  // 每 5 分钟清理一次不活跃的 key
  const CLEANUP_INTERVAL = 5 * 60_000;
  let lastCleanup = Date.now();

  function cleanup(now: number) {
    if (now - lastCleanup < CLEANUP_INTERVAL) return;
    lastCleanup = now;

    for (const [key, entry] of store) {
      // 过滤掉窗口外的时间戳
      entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);
      if (entry.timestamps.length === 0) {
        store.delete(key);
      }
    }
  }

  return async (c: Context, next: Next) => {
    // 跳过判断
    if (skip?.(c)) {
      await next();
      return;
    }

    const now = Date.now();
    const key = keyExtractor(c);

    // 定期清理
    cleanup(now);

    // 获取或创建条目
    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    // 过滤窗口外的时间戳
    entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);

    // 检查是否超限
    if (entry.timestamps.length >= max) {
      // 计算最早的请求什么时候过期
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = windowMs - (now - oldestInWindow);
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);

      c.header('Retry-After', String(retryAfterSec));
      c.header('X-RateLimit-Limit', String(max));
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', String(Math.ceil((oldestInWindow + windowMs) / 1000)));

      return c.json({ error: message }, 429);
    }

    // 记录这次请求
    entry.timestamps.push(now);

    // 设置 rate limit headers
    const remaining = max - entry.timestamps.length;
    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(remaining));

    // 估算重置时间（最早时间戳 + 窗口大小）
    const resetTime = entry.timestamps[0] + windowMs;
    c.header('X-RateLimit-Reset', String(Math.ceil(resetTime / 1000)));

    await next();
  };
}

// === 辅助函数 ===

/**
 * 默认 key 提取器：
 * 1. 优先用 agentId（鉴权后的变量）
 * 2. 回退到 IP 地址
 */
function defaultKeyExtractor(c: Context): string {
  // agentId 是鉴权中间件设置的
  const agentId = c.get('agentId') as string | undefined;
  if (agentId) return `agent:${agentId}`;

  // 回退到 IP（适用于未鉴权的端点如 /register）
  const forwarded = c.req.header('X-Forwarded-For');
  if (forwarded) return `ip:${forwarded.split(',')[0].trim()}`;

  // Hono 没有内置的 IP 获取，用 header 兜底
  return `ip:unknown`;
}

/**
 * 获取当前 store 大小（用于监控/调试）
 */
export function createRateLimitStats(limiter: ReturnType<typeof createRateLimiter>) {
  // 这个函数预留，以后可以暴露统计接口
  return {};
}

// === 预设配置 ===

/** API 端点默认限流：每 key 每分钟 60 次 */
export const API_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  max: 60,
  message: '请求过于频繁（每分钟最多 60 次），请稍后再试',
};

/** 注册端点限流：每 IP 每分钟 5 次（防注册滥用） */
export const REGISTER_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  max: 5,
  message: '注册请求过于频繁（每分钟最多 5 次），请稍后再试',
};

/** 搜索端点限流：每 key 每分钟 30 次（搜索比较重） */
export const SEARCH_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  max: 30,
  message: '搜索请求过于频繁（每分钟最多 30 次），请稍后再试',
};
