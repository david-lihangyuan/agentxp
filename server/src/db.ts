/**
 * 数据库层 — libSQL（兼容 SQLite + Turso）
 *
 * 本地开发：DB_URL=file:./data/experiences.db
 * 生产环境：DB_URL=libsql://xxx.turso.io  DB_AUTH_TOKEN=xxx
 *
 * 所有操作均为 async，适配 libSQL 的异步 API。
 */

import { createClient, type Client, type InStatement } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import type { Experience, VerifyResult, VerificationSummary } from './types.js';
import { AUTH_SCHEMA_SQL, migrateApiKeysTable } from './shared-auth.js';

let client: Client;

export async function initDB(url: string, authToken?: string): Promise<Client> {
  client = createClient({
    url,
    authToken,
  });

  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS experiences (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL DEFAULT 'serendip-experience/0.1',
      published_at TEXT NOT NULL,
      updated_at TEXT,
      ttl_days INTEGER,

      -- publisher
      publisher_agent_id TEXT NOT NULL,
      publisher_platform TEXT NOT NULL,
      publisher_operator TEXT,

      -- core
      what TEXT NOT NULL,
      context TEXT NOT NULL,
      tried TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','failed','partial','inconclusive')),
      outcome_detail TEXT NOT NULL,
      learned TEXT NOT NULL,

      -- tags 存为 JSON 数组
      tags TEXT NOT NULL DEFAULT '[]',

      -- agent_context 存为 JSON
      agent_context TEXT,

      -- trust
      operator_endorsed INTEGER NOT NULL DEFAULT 0,

      -- embedding（1536 维 float32 → base64 编码）
      embedding TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_exp_agent ON experiences(publisher_agent_id);
    CREATE INDEX IF NOT EXISTS idx_exp_outcome ON experiences(outcome);
    CREATE INDEX IF NOT EXISTS idx_exp_published ON experiences(published_at);

    CREATE TABLE IF NOT EXISTS verifications (
      id TEXT PRIMARY KEY,
      experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
      verifier_agent_id TEXT NOT NULL,
      verifier_platform TEXT NOT NULL,
      result TEXT NOT NULL CHECK(result IN ('confirmed','denied','conditional')),
      conditions TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,

      UNIQUE(experience_id, verifier_agent_id)
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      key TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    ${AUTH_SCHEMA_SQL}
  `);

  // 运行时迁移：给旧 api_keys 表加 user_id 和 name 列
  await migrateApiKeysTable(client);

  return client;
}

export function getClient(): Client {
  if (!client) throw new Error('数据库未初始化，先调用 initDB()');
  return client;
}

// === Embedding 序列化（Float32Array ↔ base64 字符串）===
// libSQL HTTP 协议不支持原始 BLOB，用 base64 编码存 TEXT 列

function embeddingToBase64(embedding: Float32Array): string {
  const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  return buf.toString('base64');
}

function base64ToEmbedding(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// === 经验操作 ===

export async function insertExperience(exp: Experience, embedding: Float32Array | null): Promise<string> {
  const id = exp.id || randomUUID();
  const now = new Date().toISOString();

  await getClient().execute({
    sql: `
      INSERT INTO experiences (
        id, version, published_at, updated_at, ttl_days,
        publisher_agent_id, publisher_platform, publisher_operator,
        what, context, tried, outcome, outcome_detail, learned,
        tags, agent_context, operator_endorsed, embedding
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `,
    args: [
      id,
      exp.version ?? 'serendip-experience/0.1',
      exp.published_at || now,
      exp.updated_at ?? null,
      exp.ttl_days ?? null,
      exp.publisher.agent_id,
      exp.publisher.platform ?? 'unknown',
      exp.publisher.operator ?? null,
      exp.core.what,
      exp.core.context ?? '',
      exp.core.tried,
      exp.core.outcome ?? 'unknown',
      exp.core.outcome_detail ?? null,
      exp.core.learned,
      JSON.stringify(exp.tags ?? []),
      exp.agent_context ? JSON.stringify(exp.agent_context) : null,
      exp.trust?.operator_endorsed ? 1 : 0,
      embedding ? embeddingToBase64(embedding) : null,
    ],
  });

  return id;
}

export async function getExperience(id: string): Promise<Experience | null> {
  const result = await getClient().execute({
    sql: 'SELECT * FROM experiences WHERE id = ?',
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return rowToExperience(result.rows[0]);
}

export async function getAllEmbeddings(): Promise<Array<{ id: string; embedding: Float32Array }>> {
  const result = await getClient().execute(
    'SELECT id, embedding FROM experiences WHERE embedding IS NOT NULL'
  );

  return result.rows.map(r => ({
    id: r.id as string,
    embedding: base64ToEmbedding(r.embedding as string),
  }));
}

export async function getExperiencesByIds(ids: string[]): Promise<Experience[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const result = await getClient().execute({
    sql: `SELECT * FROM experiences WHERE id IN (${placeholders})`,
    args: ids,
  });
  return result.rows.map(rowToExperience);
}

// === 验证操作 ===

export async function insertVerification(
  experienceId: string,
  verifierAgentId: string,
  verifierPlatform: string,
  result: VerifyResult,
  conditions?: string | null,
  notes?: string | null
): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();

  await getClient().execute({
    sql: `
      INSERT OR REPLACE INTO verifications (id, experience_id, verifier_agent_id, verifier_platform, result, conditions, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [id, experienceId, verifierAgentId, verifierPlatform, result, conditions || null, notes || null, now],
  });

  return id;
}

export async function getVerificationSummary(experienceId: string): Promise<VerificationSummary> {
  const result = await getClient().execute({
    sql: 'SELECT result, COUNT(*) as cnt FROM verifications WHERE experience_id = ? GROUP BY result',
    args: [experienceId],
  });

  const summary: VerificationSummary = { total: 0, confirmed: 0, denied: 0, conditional: 0 };
  for (const r of result.rows) {
    const key = r.result as keyof Omit<VerificationSummary, 'total'>;
    const cnt = Number(r.cnt);
    summary[key] = cnt;
    summary.total += cnt;
  }
  return summary;
}

// === API key ===

export async function getAgentByKey(key: string): Promise<string | null> {
  const result = await getClient().execute({
    sql: 'SELECT agent_id FROM api_keys WHERE key = ?',
    args: [key],
  });
  return result.rows.length > 0 ? (result.rows[0].agent_id as string) : null;
}

// === 工具函数 ===

function rowToExperience(row: any): Experience {
  return {
    id: row.id,
    version: row.version,
    published_at: row.published_at,
    updated_at: row.updated_at,
    ttl_days: row.ttl_days != null ? Number(row.ttl_days) : undefined,
    publisher: {
      agent_id: row.publisher_agent_id,
      platform: row.publisher_platform,
      operator: row.publisher_operator,
    },
    core: {
      what: row.what,
      context: row.context,
      tried: row.tried,
      outcome: row.outcome,
      outcome_detail: row.outcome_detail,
      learned: row.learned,
    },
    tags: JSON.parse(row.tags as string),
    agent_context: row.agent_context ? JSON.parse(row.agent_context as string) : undefined,
    trust: { operator_endorsed: !!row.operator_endorsed },
  };
}
