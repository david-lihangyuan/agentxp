/**
 * Serendip 协议 — 通用 Embedding 模块
 *
 * 所有场景共享的 embedding 逻辑：API 调用、mock、demo、余弦相似度。
 * 内置内存缓存层 — 相同文本不重复调 API。
 *
 * 不依赖任何 npm 包（仅用 Node.js 内置 fetch）。
 */

// === 常量 ===

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIM = 1536;

// === 状态 ===

let apiKey: string;
let baseUrl = 'https://api.openai.com/v1';
let mockMode = false;
let demoMode = false;

// === 初始化 ===

export function initEmbedding(key: string, base?: string, mock?: boolean, demo?: boolean) {
  apiKey = key;
  if (base) baseUrl = base;
  if (mock) mockMode = true;
  if (demo) { demoMode = true; mockMode = true; }
}

export function isDemoMode(): boolean { return demoMode; }

// === 内存缓存 ===

const cache = new Map<string, Float32Array>();
let cacheMaxSize = 10000;
let cacheHits = 0;
let cacheMisses = 0;

/**
 * 设置缓存最大条目数（默认 10000）
 */
export function setEmbeddingCacheMaxSize(maxSize: number) {
  cacheMaxSize = maxSize;
}

/**
 * 清空缓存
 */
export function clearEmbeddingCache() {
  cache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

/**
 * 获取缓存统计
 */
export function getEmbeddingCacheStats() {
  return {
    size: cache.size,
    maxSize: cacheMaxSize,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: cacheHits + cacheMisses > 0
      ? cacheHits / (cacheHits + cacheMisses)
      : 0,
  };
}

// === Mock Embedding ===

/**
 * 确定性伪随机向量：同样的文本总是产生同样的向量
 * 不同的文本产生不同的向量，但没有语义意义
 */
export function mockEmbedding(text: string): Float32Array {
  const vec = new Float32Array(EMBEDDING_DIM);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    hash = ((hash << 13) ^ hash) | 0;
    hash = (hash * 1103515245 + 12345) | 0;
    vec[i] = (hash & 0x7fffffff) / 0x7fffffff - 0.5;
  }
  // 归一化
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < EMBEDDING_DIM; i++) vec[i] /= norm;
  return vec;
}

// === Demo Embedding (bag-of-words) ===

// 预定义词汇表 — 覆盖常见技术能力关键词
const DEMO_VOCAB: string[] = [
  // 编程语言与框架
  'code', 'typescript', 'javascript', 'python', 'rust', 'go', 'java',
  'react', 'node', 'api', 'backend', 'frontend', 'fullstack',
  // 开发技能
  'review', 'analysis', 'testing', 'debug', 'refactor', 'optimize',
  'deploy', 'ci', 'cd', 'pipeline', 'automation', 'build',
  // AI/ML
  'ai', 'ml', 'machine', 'learning', 'model', 'training', 'inference',
  'embedding', 'vector', 'llm', 'agent', 'prompt', 'rag', 'fine',
  // 数据
  'data', 'database', 'sql', 'nosql', 'redis', 'postgres', 'sqlite',
  'etl', 'transform', 'analytics', 'visualization', 'chart',
  // 基础设施
  'cloud', 'aws', 'docker', 'kubernetes', 'server', 'infra',
  'monitor', 'log', 'alert', 'security', 'auth', 'network',
  // 文本与翻译
  'translate', 'translation', 'language', 'nlp', 'text', 'document',
  'write', 'content', 'markdown', 'summary', 'extract',
  // 通用
  'search', 'discover', 'match', 'recommend', 'web', 'browser',
  'scrape', 'crawl', 'parse', 'convert', 'format', 'image',
  'audio', 'video', 'file', 'storage', 'cache', 'queue',
  'weather', 'email', 'notification', 'schedule', 'task',
  'tool', 'plugin', 'skill', 'capability', 'service',
];

/**
 * Demo 模式：基于关键词的 bag-of-words 向量
 * 语义相近的文本（共享关键词）自然产生高 cosine similarity
 */
export function demoEmbedding(text: string): Float32Array {
  const vec = new Float32Array(EMBEDDING_DIM);

  // 文本 → 小写 → 分词
  const words = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').split(/\s+/);
  const wordSet = new Set(words);

  // 前段：词汇表位置（有序特征，主要贡献相似度）
  for (let i = 0; i < DEMO_VOCAB.length && i < EMBEDDING_DIM; i++) {
    const term = DEMO_VOCAB[i];
    if (wordSet.has(term)) {
      vec[i] = 1.0;
    } else {
      // 子串匹配（弱信号）
      for (const w of words) {
        if (w.length >= 3 && (w.includes(term) || term.includes(w))) {
          vec[i] = 0.4;
          break;
        }
      }
    }
  }

  // 后段：用确定性 hash 填充（增加维度多样性，防止全零向量）
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  for (let i = DEMO_VOCAB.length; i < EMBEDDING_DIM; i++) {
    hash = ((hash << 13) ^ hash) | 0;
    hash = (hash * 1103515245 + 12345) | 0;
    vec[i] = ((hash & 0x7fffffff) / 0x7fffffff - 0.5) * 0.05; // 很小的噪声
  }

  // 归一化
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < EMBEDDING_DIM; i++) vec[i] /= norm;
  return vec;
}

// === 核心 API 调用（带缓存） ===

export async function getEmbedding(text: string): Promise<Float32Array> {
  if (demoMode) return demoEmbedding(text);
  if (mockMode) return mockEmbedding(text);

  // 查缓存
  const cached = cache.get(text);
  if (cached) {
    cacheHits++;
    return cached;
  }
  cacheMisses++;

  const resp = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      encoding_format: 'float',
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Embedding API 错误 ${resp.status}: ${err}`);
  }

  const data = await resp.json() as any;
  const values = data.data[0].embedding as number[];
  const vec = new Float32Array(values);

  // 存入缓存（LRU 简化版：超限时删最早的条目）
  if (cache.size >= cacheMaxSize) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(text, vec);

  return vec;
}

// === 余弦相似度 ===

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
