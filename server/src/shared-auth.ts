/**
 * Serendip 协议 — 通用用户注册 + API key 管理模块
 *
 * 所有场景共享。依赖调用方传入 libSQL Client 实例。
 *
 * 表结构（调用方在 initDB 中创建）：
 *   users: id, agent_id (UNIQUE), name, created_at
 *   api_keys: key, user_id, agent_id, name, created_at
 */

import { randomUUID, randomBytes } from 'node:crypto';
import type { Client } from '@libsql/client';

// === 常量 ===

/** API key 前缀，方便识别和 grep 日志 */
const KEY_PREFIX = 'sxp_';
/** 随机部分字节数（32字节 = 64 hex 字符） */
const KEY_RANDOM_BYTES = 32;
/** 每个用户最多持有的 key 数量 */
const MAX_KEYS_PER_USER = 5;

// === 类型 ===

export interface RegisterRequest {
  /** agent 唯一标识（如 "openclaw/steipete" 或任意字符串） */
  agent_id: string;
  /** 可选的显示名称 */
  name?: string;
}

export interface RegisterResponse {
  status: 'created' | 'existing';
  user_id: string;
  agent_id: string;
  api_key: string;
  message: string;
}

export interface UserInfo {
  id: string;
  agent_id: string;
  name: string | null;
  created_at: string;
}

// === SQL 建表（追加到调用方的 initDB） ===

/**
 * 返回建表 SQL，调用方在 executeMultiple 里拼接。
 * 注意：保留旧 api_keys 表兼容性 — 新表加了 user_id 和 name 列。
 */
export const AUTH_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at TEXT NOT NULL
  );

  -- 迁移旧 api_keys 表：如果没有 user_id 列则加上
  -- SQLite 不支持 IF NOT EXISTS 加列，用 try-catch 在代码层处理
`;

/**
 * 运行时迁移：给旧 api_keys 表加 user_id 和 name 列（如果还没有）。
 * 幂等操作，可以重复调用。
 */
export async function migrateApiKeysTable(client: Client): Promise<void> {
  // 检查 api_keys 表是否有 user_id 列
  const info = await client.execute("PRAGMA table_info(api_keys)");
  const columns = new Set(info.rows.map(r => r.name as string));

  if (!columns.has('user_id')) {
    await client.execute('ALTER TABLE api_keys ADD COLUMN user_id TEXT');
  }
  if (!columns.has('name')) {
    await client.execute('ALTER TABLE api_keys ADD COLUMN name TEXT');
  }
}

// === 核心逻辑 ===

/** 生成 API key：sxp_ + 64 hex 字符 */
function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(KEY_RANDOM_BYTES).toString('hex');
}

/**
 * 注册用户并返回 API key。
 * - 如果 agent_id 已注册，为其生成新 key（不超过上限）
 * - 如果是新用户，创建用户 + 第一个 key
 */
export async function registerUser(
  client: Client,
  req: RegisterRequest,
): Promise<RegisterResponse> {
  const { agent_id, name } = req;

  if (!agent_id || agent_id.trim().length === 0) {
    throw new Error('agent_id 不能为空');
  }

  // 查找已有用户
  const existing = await client.execute({
    sql: 'SELECT id, agent_id, name, created_at FROM users WHERE agent_id = ?',
    args: [agent_id],
  });

  let userId: string;
  let status: 'created' | 'existing';

  if (existing.rows.length > 0) {
    // 已注册用户 — 检查 key 数量
    userId = existing.rows[0].id as string;
    status = 'existing';

    const keyCount = await client.execute({
      sql: 'SELECT COUNT(*) as cnt FROM api_keys WHERE agent_id = ?',
      args: [agent_id],
    });
    const count = Number(keyCount.rows[0].cnt);

    if (count >= MAX_KEYS_PER_USER) {
      throw new Error(`已达到 API key 上限（${MAX_KEYS_PER_USER}个），请先撤销旧 key`);
    }
  } else {
    // 新用户
    userId = randomUUID();
    status = 'created';
    const now = new Date().toISOString();

    await client.execute({
      sql: 'INSERT INTO users (id, agent_id, name, created_at) VALUES (?, ?, ?, ?)',
      args: [userId, agent_id, name || null, now],
    });
  }

  // 生成 API key
  const apiKey = generateApiKey();
  const now = new Date().toISOString();

  await client.execute({
    sql: 'INSERT INTO api_keys (key, user_id, agent_id, name, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [apiKey, userId, agent_id, name ? `${name} 的 key` : 'default', now],
  });

  return {
    status,
    user_id: userId,
    agent_id,
    api_key: apiKey,
    message: status === 'created'
      ? `注册成功！请保存你的 API key，它只显示一次。`
      : `已为你生成新的 API key。`,
  };
}

/**
 * 查询用户信息（通过 agent_id）
 */
export async function getUserByAgentId(
  client: Client,
  agentId: string,
): Promise<UserInfo | null> {
  const result = await client.execute({
    sql: 'SELECT id, agent_id, name, created_at FROM users WHERE agent_id = ?',
    args: [agentId],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id as string,
    agent_id: row.agent_id as string,
    name: row.name as string | null,
    created_at: row.created_at as string,
  };
}

/**
 * 列出用户的所有 API key（脱敏显示）
 */
export async function listUserKeys(
  client: Client,
  agentId: string,
): Promise<Array<{ key_prefix: string; name: string | null; created_at: string }>> {
  const result = await client.execute({
    sql: 'SELECT key, name, created_at FROM api_keys WHERE agent_id = ? ORDER BY created_at DESC',
    args: [agentId],
  });
  return result.rows.map(r => ({
    // 只显示前 12 个字符 + ...
    key_prefix: (r.key as string).slice(0, 12) + '...',
    name: r.name as string | null,
    created_at: r.created_at as string,
  }));
}

/**
 * 撤销指定 API key（需要完整 key）
 */
export async function revokeApiKey(
  client: Client,
  agentId: string,
  key: string,
): Promise<boolean> {
  const result = await client.execute({
    sql: 'DELETE FROM api_keys WHERE key = ? AND agent_id = ?',
    args: [key, agentId],
  });
  return result.rowsAffected > 0;
}
