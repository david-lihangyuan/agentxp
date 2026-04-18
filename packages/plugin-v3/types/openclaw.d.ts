// Ambient module declarations for the OpenClaw host SDK.
// OpenClaw is an optional peer dependency provided by the host at runtime;
// there is no npm-installed package with types during development. These
// declarations cover only the surface this plugin actually consumes.

declare module 'openclaw/plugin-sdk/plugin-entry' {
  export interface PluginLogger {
    info(msg: string): void
    warn(msg: string): void
    error(msg: string): void
    debug?(msg: string): void
  }

  export interface OpenClawPluginServiceContext {
    logger?: PluginLogger
    [key: string]: unknown
  }

  // The host-provided API object carries arbitrarily nested runtime config
  // and helper services. We keep `config`, `runtime`, and `pluginConfig` as
  // `any` because their concrete shape is owned by the host, not this plugin.
  export interface OpenClawPluginApi {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any
    logger?: PluginLogger
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pluginConfig?: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runtime?: any
    resolvePath?(...parts: string[]): string
    registerMemoryCorpusSupplement?(supplement: unknown): void
    registerMemoryPromptSupplement?(supplement: unknown): void
    registerService?(service: {
      id: string
      start(context: OpenClawPluginServiceContext): Promise<void> | void
      stop(context: OpenClawPluginServiceContext): Promise<void> | void
    }): void
    [key: string]: unknown
  }

  export interface PluginEntry {
    id: string
    name: string
    description?: string
    register(api: OpenClawPluginApi): void
  }

  export function definePluginEntry(entry: PluginEntry): PluginEntry
}

declare module 'openclaw/plugin-sdk/memory-core-host-engine-embeddings' {
  export interface EmbeddingProvider {
    id: string
    model: string
    embedQuery(text: string): Promise<number[]>
    embedBatch(texts: string[]): Promise<number[][]>
  }

  export interface EmbeddingProviderAdapter {
    id: string
    defaultModel?: string
    create(options: {
      config: Record<string, unknown>
      model: string
    }): Promise<{ provider: EmbeddingProvider | null }>
  }

  export const DEFAULT_LOCAL_MODEL: string

  export function createLocalEmbeddingProvider(options: {
    config: Record<string, unknown>
    provider: string
    model: string
    fallback: string
  }): Promise<EmbeddingProvider>

  export function listMemoryEmbeddingProviders(
    config: Record<string, unknown>,
  ): EmbeddingProviderAdapter[]

  export function getMemoryEmbeddingProvider(
    config: Record<string, unknown>,
    id: string,
  ): EmbeddingProvider | null
}
