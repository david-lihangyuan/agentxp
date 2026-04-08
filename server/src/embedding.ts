/**
 * Experience Network — Embedding 模块
 * 核心逻辑从 shared/embedding.ts 导入，这里只保留场景特有的 toText
 */

export {
  initEmbedding,
  getEmbedding,
  cosineSimilarity,
  EMBEDDING_DIM,
  clearEmbeddingCache,
  getEmbeddingCacheStats,
} from './shared-embedding.js';

/**
 * 将经验的关键字段拼接成一段文本用于嵌入
 */
export function experienceToText(exp: {
  what: string;
  context: string;
  tried: string;
  learned: string;
  tags: string[];
}): string {
  return [
    exp.what,
    exp.context,
    exp.tried,
    exp.learned,
    exp.tags.join(', ')
  ].join('\n');
}
