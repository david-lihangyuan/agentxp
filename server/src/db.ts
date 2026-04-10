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
import type { Experience, ExecutableContent, VerifyResult, VerificationSummary } from './types.js';
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

    CREATE TABLE IF NOT EXISTS experience_executables (
      id TEXT PRIMARY KEY,
      experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL CHECK(type IN ('snippet', 'config', 'command', 'test')),
      language TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT NOT NULL,
      requires TEXT,
      verify_command TEXT,
      verify_expect TEXT,
      UNIQUE(experience_id, seq)
    );

    CREATE INDEX IF NOT EXISTS idx_exec_exp ON experience_executables(experience_id);

    CREATE TABLE IF NOT EXISTS search_logs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      query TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 0,
      precision_hits INTEGER NOT NULL DEFAULT 0,
      serendipity_hits INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_search_logs_agent ON search_logs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_search_logs_time ON search_logs(created_at);

    ${AUTH_SCHEMA_SQL}
  `);

  // 运行时迁移：给旧 api_keys 表加 user_id 和 name 列
  await migrateApiKeysTable(client);

  // 运行时迁移：积分系统
  const { migrateCredits } = await import('./credits.js');
  await migrateCredits();

  // 运行时迁移：求助系统
  const { migrateHelp } = await import('./help.js');
  await migrateHelp();

  // 运行时迁移：经验版本 + 状态（Phase 1.1）
  await migrateExperienceVersionStatus(client);

  return client;
}

/** 幂等迁移：experiences 表加 context_version 和 status 列 */
async function migrateExperienceVersionStatus(client: Client) {
  // context_version: 经验产生时的上下文版本（如 "openclaw@2026.4.5"）
  try {
    await client.execute({ sql: `ALTER TABLE experiences ADD COLUMN context_version TEXT`, args: [] });
  } catch (e: any) {
    if (!e.message?.includes('duplicate column')) throw e;
  }
  // status: active / outdated / resolved，默认 active
  try {
    await client.execute({ sql: `ALTER TABLE experiences ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'outdated', 'resolved'))`, args: [] });
  } catch (e: any) {
    if (!e.message?.includes('duplicate column')) throw e;
  }
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

// === 可执行内容操作 ===

export async function insertExecutables(experienceId: string, executables: ExecutableContent[]): Promise<void> {
  for (let i = 0; i < executables.length; i++) {
    const exec = executables[i];
    await getClient().execute({
      sql: `
        INSERT INTO experience_executables (
          id, experience_id, seq, type, language, code, description,
          requires, verify_command, verify_expect
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        randomUUID(),
        experienceId,
        i,
        exec.type,
        exec.language,
        exec.code,
        exec.description,
        exec.requires ? JSON.stringify(exec.requires) : null,
        exec.verify?.command ?? null,
        exec.verify?.expect ?? null,
      ],
    });
  }
}

export async function getExecutables(experienceId: string): Promise<ExecutableContent[]> {
  const result = await getClient().execute({
    sql: 'SELECT * FROM experience_executables WHERE experience_id = ? ORDER BY seq',
    args: [experienceId],
  });
  return result.rows.map(rowToExecutable);
}

export async function getExecutablesByIds(experienceIds: string[]): Promise<Map<string, ExecutableContent[]>> {
  if (experienceIds.length === 0) return new Map();
  const placeholders = experienceIds.map(() => '?').join(',');
  const result = await getClient().execute({
    sql: `SELECT * FROM experience_executables WHERE experience_id IN (${placeholders}) ORDER BY experience_id, seq`,
    args: experienceIds,
  });
  const map = new Map<string, ExecutableContent[]>();
  for (const row of result.rows) {
    const expId = row.experience_id as string;
    if (!map.has(expId)) map.set(expId, []);
    map.get(expId)!.push(rowToExecutable(row));
  }
  return map;
}

export async function hasExecutable(experienceId: string): Promise<boolean> {
  const result = await getClient().execute({
    sql: 'SELECT 1 FROM experience_executables WHERE experience_id = ? LIMIT 1',
    args: [experienceId],
  });
  return result.rows.length > 0;
}

function rowToExecutable(row: any): ExecutableContent {
  const exec: ExecutableContent = {
    type: row.type,
    language: row.language,
    code: row.code,
    description: row.description,
  };
  if (row.requires) {
    exec.requires = JSON.parse(row.requires as string);
  }
  if (row.verify_command) {
    exec.verify = {
      command: row.verify_command,
      expect: row.verify_expect || '',
    };
  }
  return exec;
}

export async function insertExperience(exp: Experience, embedding: Float32Array | null): Promise<string> {
  const id = exp.id || randomUUID();
  const now = new Date().toISOString();

  await getClient().execute({
    sql: `
      INSERT INTO experiences (
        id, version, published_at, updated_at, ttl_days,
        publisher_agent_id, publisher_platform, publisher_operator,
        what, context, tried, outcome, outcome_detail, learned,
        tags, agent_context, operator_endorsed, embedding,
        context_version, status
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
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
      exp.core.outcome ?? 'inconclusive',
      exp.core.outcome_detail ?? null,
      exp.core.learned,
      JSON.stringify(exp.tags ?? []),
      exp.agent_context ? JSON.stringify(exp.agent_context) : null,
      exp.trust?.operator_endorsed ? 1 : 0,
      embedding ? embeddingToBase64(embedding) : null,
      exp.context_version ?? null,
      exp.status ?? 'active',
    ],
  });

  return id;
}

/** 更新经验状态（仅原作者可调用） */
export async function updateExperienceStatus(id: string, status: 'active' | 'outdated' | 'resolved'): Promise<boolean> {
  const result = await getClient().execute({
    sql: `UPDATE experiences SET status = ?, updated_at = ? WHERE id = ?`,
    args: [status, new Date().toISOString(), id],
  });
  return (result.rowsAffected ?? 0) > 0;
}

/** 删除经验及其关联数据（验证、可执行内容、积分记录）。仅原作者可调用。 */
export async function deleteExperience(id: string): Promise<boolean> {
  const db = getClient();
  // 关联表有 ON DELETE CASCADE，但 search_hit_credits 没有外键，手动清理
  await db.execute({ sql: `DELETE FROM search_hit_credits WHERE experience_id = ?`, args: [id] }).catch(() => {});
  // credit_ledger 里有 reference 字段记录经验 ID，也清理
  await db.execute({ sql: `DELETE FROM credit_ledger WHERE reference = ?`, args: [id] }).catch(() => {});
  const result = await db.execute({
    sql: `DELETE FROM experiences WHERE id = ?`,
    args: [id],
  });
  return (result.rowsAffected ?? 0) > 0;
}

export async function getExperience(id: string): Promise<Experience | null> {
  const result = await getClient().execute({
    sql: 'SELECT * FROM experiences WHERE id = ?',
    args: [id],
  });
  if (result.rows.length === 0) return null;
  const exp = rowToExperience(result.rows[0]);
  // v0.2: 加载可执行内容
  const executables = await getExecutables(id);
  if (executables.length > 0) exp.executable = executables;
  return exp;
}

// === 统计查询 ===
export interface NetworkStats {
  total_experiences: number;
  total_agents: number;
  total_verifications: number;
  total_executables: number;
  outcome_breakdown: Record<string, number>;
  verification_breakdown: Record<string, number>;
  recent_24h: { experiences: number; verifications: number };
  top_tags: Array<{ tag: string; count: number }>;
  avg_verifications_per_experience: number;
}

export async function getNetworkStats(): Promise<NetworkStats> {
  const db = getClient();
  
  // 并行查询
  const [expCount, agentCount, verCount, execCount, outcomes, verResults, recent24hExp, recent24hVer, allTags, avgVer] = await Promise.all([
    db.execute('SELECT COUNT(*) as c FROM experiences'),
    db.execute('SELECT COUNT(DISTINCT publisher_agent_id) as c FROM experiences'),
    db.execute('SELECT COUNT(*) as c FROM verifications'),
    db.execute('SELECT COUNT(*) as c FROM experience_executables'),
    db.execute('SELECT outcome, COUNT(*) as c FROM experiences GROUP BY outcome'),
    db.execute('SELECT result, COUNT(*) as c FROM verifications GROUP BY result'),
    db.execute("SELECT COUNT(*) as c FROM experiences WHERE published_at > datetime('now', '-1 day')"),
    db.execute("SELECT COUNT(*) as c FROM verifications WHERE created_at > datetime('now', '-1 day')"),
    db.execute('SELECT tags FROM experiences'),
    db.execute('SELECT AVG(cnt) as a FROM (SELECT experience_id, COUNT(*) as cnt FROM verifications GROUP BY experience_id)'),
  ]);

  // 统计标签频率
  const tagFreq = new Map<string, number>();
  for (const row of allTags.rows) {
    try {
      const tags = JSON.parse(row.tags as string) as string[];
      for (const t of tags) {
        tagFreq.set(t, (tagFreq.get(t) || 0) + 1);
      }
    } catch {}
  }
  const topTags = [...tagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }));

  const outcomeBreakdown: Record<string, number> = {};
  for (const row of outcomes.rows) {
    outcomeBreakdown[row.outcome as string] = row.c as number;
  }

  const verBreakdown: Record<string, number> = {};
  for (const row of verResults.rows) {
    verBreakdown[row.result as string] = row.c as number;
  }

  return {
    total_experiences: expCount.rows[0].c as number,
    total_agents: agentCount.rows[0].c as number,
    total_verifications: verCount.rows[0].c as number,
    total_executables: execCount.rows[0].c as number,
    outcome_breakdown: outcomeBreakdown,
    verification_breakdown: verBreakdown,
    recent_24h: {
      experiences: recent24hExp.rows[0].c as number,
      verifications: recent24hVer.rows[0].c as number,
    },
    top_tags: topTags,
    avg_verifications_per_experience: Math.round(((avgVer.rows[0]?.a as number) || 0) * 100) / 100,
  };
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

export async function getExperiencesByIds(ids: string[], includeExecutables = true): Promise<Experience[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const result = await getClient().execute({
    sql: `SELECT * FROM experiences WHERE id IN (${placeholders})`,
    args: ids,
  });
  const experiences = result.rows.map(rowToExperience);
  if (includeExecutables) {
    const execMap = await getExecutablesByIds(ids);
    for (const exp of experiences) {
      const execs = execMap.get(exp.id);
      if (execs && execs.length > 0) exp.executable = execs;
    }
  }
  return experiences;
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
      INSERT INTO verifications (id, experience_id, verifier_agent_id, verifier_platform, result, conditions, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(experience_id, verifier_agent_id) DO UPDATE SET
        result = excluded.result,
        conditions = excluded.conditions,
        notes = excluded.notes,
        created_at = excluded.created_at
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

/**
 * 查询某个 agent 已经验证过的经验 ID 集合（从给定候选列表中筛选）
 */
export async function getAgentVerifiedIds(agentId: string, candidateIds: string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  const db = getClient();
  // 批量查询，用 IN 子句
  const placeholders = candidateIds.map(() => '?').join(',');
  const result = await db.execute({
    sql: `SELECT DISTINCT experience_id FROM verifications WHERE verifier_agent_id = ? AND experience_id IN (${placeholders})`,
    args: [agentId, ...candidateIds],
  });
  return new Set(result.rows.map(r => r.experience_id as string));
}

// === API key ===

export async function getAgentByKey(key: string): Promise<string | null> {
  const result = await getClient().execute({
    sql: 'SELECT agent_id FROM api_keys WHERE key = ?',
    args: [key],
  });
  return result.rows.length > 0 ? (result.rows[0].agent_id as string) : null;
}

// === Browse (浏览/过滤) ===

export interface BrowseOptions {
  tag?: string;
  agent_id?: string;
  outcome?: string;
  limit?: number;
  offset?: number;
}

export async function browseExperiences(opts: BrowseOptions): Promise<{ experiences: Experience[]; total: number }> {
  const db = getClient();
  const conditions: string[] = [];
  const args: any[] = [];

  if (opts.tag) {
    // tags 存为 JSON 数组，用 LIKE 模糊匹配
    conditions.push("tags LIKE '%' || ? || '%'");
    args.push('"' + opts.tag + '"');
  }
  if (opts.agent_id) {
    conditions.push('publisher_agent_id = ?');
    args.push(opts.agent_id);
  }
  if (opts.outcome && opts.outcome !== 'any') {
    conditions.push('outcome = ?');
    args.push(opts.outcome);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = Math.min(Math.max(opts.limit || 20, 1), 50);
  const offset = Math.max(opts.offset || 0, 0);

  const [countResult, dataResult] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) as c FROM experiences ${where}`, args }),
    db.execute({ sql: `SELECT * FROM experiences ${where} ORDER BY published_at DESC LIMIT ? OFFSET ?`, args: [...args, limit, offset] }),
  ]);

  return {
    experiences: dataResult.rows.map(rowToExperience),
    total: countResult.rows[0].c as number,
  };
}

// === Discover (随机探索) ===

export async function discoverExperiences(excludeAgentId: string, limit: number = 5): Promise<Experience[]> {
  const db = getClient();
  // 随机取经验，排除自己发布的，优先近期 + 有验证的
  const result = await db.execute({
    sql: `
      SELECT e.*, 
        (SELECT COUNT(*) FROM verifications v WHERE v.experience_id = e.id AND v.result = 'confirmed') as confirm_count
      FROM experiences e
      WHERE e.publisher_agent_id != ?
      ORDER BY 
        confirm_count DESC,
        RANDOM()
      LIMIT ?
    `,
    args: [excludeAgentId, limit],
  });
  return result.rows.map(rowToExperience);
}

// === Agent Profile ===

export interface AgentProfile {
  agent_id: string;
  registered_at: string | null;
  contributions: {
    total: number;
    by_outcome: Record<string, number>;
    recent_7d: number;
  };
  verifications_received: {
    confirmed: number;
    denied: number;
    conditional: number;
    total: number;
  };
  verifications_given: number;
  experiences: Array<{
    id: string;
    what: string;
    outcome: string;
    published_at: string;
    verified: number;
  }>;
}

export async function getAgentStats(agentId: string): Promise<AgentProfile | null> {
  const db = getClient();

  // 查询注册时间
  const regResult = await db.execute({
    sql: "SELECT MIN(created_at) as registered_at FROM api_keys WHERE agent_id = ?",
    args: [agentId],
  });
  const registeredAt = regResult.rows[0]?.registered_at as string | null;

  // 查询发布的经验
  const expResult = await db.execute({
    sql: "SELECT id, what, outcome, published_at FROM experiences WHERE publisher_agent_id = ? ORDER BY published_at DESC",
    args: [agentId],
  });

  if (expResult.rows.length === 0 && !registeredAt) {
    return null;
  }

  // 统计 outcome 分布
  const byOutcome: Record<string, number> = {};
  for (const row of expResult.rows) {
    const o = row.outcome as string;
    byOutcome[o] = (byOutcome[o] || 0) + 1;
  }

  // 最近 7 天的贡献
  const recent7dResult = await db.execute({
    sql: "SELECT COUNT(*) as c FROM experiences WHERE publisher_agent_id = ? AND published_at > datetime('now', '-7 days')",
    args: [agentId],
  });
  const recent7d = recent7dResult.rows[0].c as number;

  // 获取每条经验的验证数
  const expIds = expResult.rows.map(r => r.id as string);
  const verReceivedMap: Record<string, number> = {};
  if (expIds.length > 0) {
    const placeholders = expIds.map(() => '?').join(',');
    const verResult = await db.execute({
      sql: `SELECT experience_id, COUNT(*) as c FROM verifications WHERE experience_id IN (${placeholders}) GROUP BY experience_id`,
      args: expIds,
    });
    for (const row of verResult.rows) {
      verReceivedMap[row.experience_id as string] = row.c as number;
    }
  }

  // 汇总收到的验证
  const verSummaryResult = expIds.length > 0
    ? await db.execute({
        sql: `SELECT result, COUNT(*) as c FROM verifications WHERE experience_id IN (${expIds.map(() => '?').join(',')}) GROUP BY result`,
        args: expIds,
      })
    : { rows: [] };
  const verReceived = { confirmed: 0, denied: 0, conditional: 0, total: 0 };
  for (const row of verSummaryResult.rows) {
    const key = row.result as 'confirmed' | 'denied' | 'conditional';
    const cnt = row.c as number;
    verReceived[key] = cnt;
    verReceived.total += cnt;
  }

  // 给他人的验证数
  const verGivenResult = await db.execute({
    sql: "SELECT COUNT(*) as c FROM verifications WHERE verifier_agent_id = ?",
    args: [agentId],
  });
  const verGiven = verGivenResult.rows[0].c as number;

  return {
    agent_id: agentId,
    registered_at: registeredAt,
    contributions: {
      total: expResult.rows.length,
      by_outcome: byOutcome,
      recent_7d: recent7d,
    },
    verifications_received: verReceived,
    verifications_given: verGiven,
    experiences: expResult.rows.map(r => ({
      id: r.id as string,
      what: r.what as string,
      outcome: r.outcome as string,
      published_at: r.published_at as string,
      verified: verReceivedMap[r.id as string] || 0,
    })),
  };
}

// === 搜索日志操作 ===

export interface SearchLogEntry {
  agent_id: string;
  query: string;
  hits: number;
  precision_hits: number;
  serendipity_hits: number;
}

export async function insertSearchLog(entry: SearchLogEntry): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await getClient().execute({
    sql: `INSERT INTO search_logs (id, agent_id, query, hits, precision_hits, serendipity_hits, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, entry.agent_id, entry.query, entry.hits, entry.precision_hits, entry.serendipity_hits, now],
  });
  return id;
}

export interface AgentSearchStats {
  total_searches: number;
  total_hits: number;
  searches_today: number;
  hits_today: number;
  avg_hits_per_search: number;
}

export async function getAgentSearchStats(agentId: string): Promise<AgentSearchStats> {
  const db = getClient();
  const [totalResult, todayResult] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as cnt, COALESCE(SUM(hits), 0) as total_hits FROM search_logs WHERE agent_id = ?`,
      args: [agentId],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as cnt, COALESCE(SUM(hits), 0) as total_hits FROM search_logs WHERE agent_id = ? AND created_at >= date('now')`,
      args: [agentId],
    }),
  ]);

  const totalSearches = totalResult.rows[0].cnt as number;
  const totalHits = totalResult.rows[0].total_hits as number;
  const searchesToday = todayResult.rows[0].cnt as number;
  const hitsToday = todayResult.rows[0].total_hits as number;

  return {
    total_searches: totalSearches,
    total_hits: totalHits,
    searches_today: searchesToday,
    hits_today: hitsToday,
    avg_hits_per_search: totalSearches > 0 ? Math.round((totalHits / totalSearches) * 100) / 100 : 0,
  };
}

/**
 * 获取 agent 今日搜索次数（用于配额检查，从 DB 查询）
 */
export async function getSearchCountTodayFromDB(agentId: string): Promise<number> {
  const result = await getClient().execute({
    sql: `SELECT COUNT(*) as cnt FROM search_logs WHERE agent_id = ? AND created_at >= date('now')`,
    args: [agentId],
  });
  return result.rows[0].cnt as number;
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
    context_version: row.context_version ?? undefined,
    status: row.status ?? 'active',
    agent_context: row.agent_context ? JSON.parse(row.agent_context as string) : undefined,
    trust: { operator_endorsed: !!row.operator_endorsed },
  };
}
