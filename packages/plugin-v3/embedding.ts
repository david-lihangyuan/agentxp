/**
 * embedding.ts — Thin wrapper over OpenClaw's embedding providers.
 *
 * Strategy:
 *   1. Try local provider (no API key, runs offline, ~300M gguf model).
 *   2. If local fails (e.g., node-llama-cpp missing), try user's configured
 *      memory embedding provider via `getMemoryEmbeddingProvider`.
 *   3. If both fail, return null and let the caller fall back to keyword clustering.
 *
 * Returned type is the minimal shape we need: `embed(text) => Promise<number[]>`.
 */

import {
  createLocalEmbeddingProvider,
  DEFAULT_LOCAL_MODEL,
  listMemoryEmbeddingProviders,
  getMemoryEmbeddingProvider,
} from 'openclaw/plugin-sdk/memory-core-host-engine-embeddings';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';

export interface SimpleEmbedder {
  id: string;
  model: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export async function getEmbedder(api: OpenClawPluginApi): Promise<SimpleEmbedder | null> {
  // 1) Local provider (preferred — no secrets, no network).
  try {
    const provider = await createLocalEmbeddingProvider({
      config: api.config,
      provider: 'local',
      model: DEFAULT_LOCAL_MODEL,
      fallback: 'none',
    } as any);
    // Smoke test
    const probe = await provider.embedQuery('test');
    if (Array.isArray(probe) && probe.length > 0) {
      return {
        id: provider.id,
        model: provider.model,
        embed: (text) => provider.embedQuery(text),
        embedBatch: (texts) => provider.embedBatch(texts),
      };
    }
  } catch (err) {
    // local unavailable (likely no node-llama-cpp binding on this host)
    // fall through to adapter-based selection
  }

  // 2) Any registered provider configured by the user (openai, gemini, ollama, …).
  try {
    const adapters = listMemoryEmbeddingProviders(api.config);
    for (const adapter of adapters) {
      try {
        const { provider } = await adapter.create({
          config: api.config,
          model: adapter.defaultModel ?? 'default',
        } as any);
        if (provider) {
          const probe = await provider.embedQuery('test');
          if (Array.isArray(probe) && probe.length > 0) {
            return {
              id: provider.id,
              model: provider.model,
              embed: (text) => provider.embedQuery(text),
              embedBatch: (texts) => provider.embedBatch(texts),
            };
          }
        }
      } catch {
        // try next adapter
      }
    }
  } catch {
    // no adapters available
  }

  // Unreferenced parameter guard (in case api is needed later)
  void getMemoryEmbeddingProvider;

  return null;
}
