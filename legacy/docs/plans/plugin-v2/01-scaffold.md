# Task 1: Package scaffold + manifest + entry point + mock API

## 修正点
- **新增 `tests/helpers/mock-api.ts`**：完整的 Mock OpenClawPluginApi factory，所有后续 task 的测试都依赖它
- **ConfigSchema 精简**：只暴露 `mode` 和 `relayUrl` 两项，其余用代码内默认值
- **确认 manifest 格式**：只用 `openclaw.plugin.json`，不在 package.json 里重复

## 文件

- Create: `packages/plugin/package.json`
- Create: `packages/plugin/openclaw.plugin.json`
- Create: `packages/plugin/tsconfig.json`
- Create: `packages/plugin/src/index.ts`
- Create: `packages/plugin/src/types.ts`
- Create: `packages/plugin/tests/helpers/mock-api.ts`
- Test: `packages/plugin/tests/entry.test.ts`

## Tests

```typescript
// tests/entry.test.ts
import { describe, it, expect } from 'vitest'

describe('plugin entry', () => {
  it('exports a valid plugin definition', async () => {
    const mod = await import('../src/index.js')
    const entry = mod.default
    expect(entry).toBeDefined()
    expect(entry.id).toBe('agentxp')
    expect(entry.name).toBe('AgentXP')
    expect(typeof entry.register).toBe('function')
  })
})
```

## Implementation

### `openclaw.plugin.json`
```json
{
  "id": "agentxp",
  "name": "AgentXP",
  "description": "Agent experience learning and sharing",
  "version": "0.1.0",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["local", "network"],
        "default": "local"
      },
      "relayUrl": {
        "type": "string",
        "default": "https://relay.agentxp.io"
      }
    }
  }
}
```

### `src/types.ts`
```typescript
export interface PluginConfig {
  mode: 'local' | 'network'
  relayUrl: string
  // 以下不进 configSchema，代码内默认值
  maxInjectionTokens: number
  autoPublish: boolean
  weaning: { enabled: boolean; rate: number }
  weeklyDigest: boolean
}

export const DEFAULT_CONFIG: PluginConfig = {
  mode: 'local',
  relayUrl: 'https://relay.agentxp.io',
  maxInjectionTokens: 500,
  autoPublish: false,
  weaning: { enabled: true, rate: 0.1 },
  weeklyDigest: true,
}

export function resolveConfig(pluginConfig?: Record<string, unknown>): PluginConfig {
  return {
    ...DEFAULT_CONFIG,
    ...(pluginConfig as Partial<PluginConfig>),
  }
}
```

### `src/index.ts`
```typescript
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import { resolveConfig } from './types.js'

export default definePluginEntry({
  id: 'agentxp',
  name: 'AgentXP',
  description: 'Agent experience learning and sharing',
  register(api) {
    const config = resolveConfig(api.pluginConfig)
    // Tasks 2-18 register capabilities here
  },
})
```

### `tests/helpers/mock-api.ts`

Mock factory 覆盖 `OpenClawPluginApi` 的所有注册方法：

```typescript
import type { PluginHookHandlerMap, PluginHookName } from 'openclaw/plugin-sdk/plugin-entry'

export interface MockApiCapture {
  corpusSupplements: any[]
  promptSupplements: any[]
  hooks: Map<string, Function[]>
  typedHooks: Map<string, Function[]>
  services: any[]
  tools: any[]
  commands: any[]
  cliRegistrars: any[]
  httpRoutes: any[]
}

export function createMockApi(pluginConfig?: Record<string, unknown>): {
  api: any  // OpenClawPluginApi
  capture: MockApiCapture
} {
  const capture: MockApiCapture = {
    corpusSupplements: [],
    promptSupplements: [],
    hooks: new Map(),
    typedHooks: new Map(),
    services: [],
    tools: [],
    commands: [],
    cliRegistrars: [],
    httpRoutes: [],
  }

  const api = {
    id: 'agentxp',
    name: 'AgentXP',
    source: 'test',
    registrationMode: 'full' as const,
    config: {} as any,
    pluginConfig: pluginConfig ?? {},
    runtime: {} as any,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    registerMemoryCorpusSupplement: (s: any) => capture.corpusSupplements.push(s),
    registerMemoryPromptSupplement: (b: any) => capture.promptSupplements.push(b),
    registerHook: (events: string | string[], handler: Function) => {
      const evts = Array.isArray(events) ? events : [events]
      for (const e of evts) {
        if (!capture.hooks.has(e)) capture.hooks.set(e, [])
        capture.hooks.get(e)!.push(handler)
      }
    },
    on: <K extends PluginHookName>(hookName: K, handler: PluginHookHandlerMap[K]) => {
      if (!capture.typedHooks.has(hookName)) capture.typedHooks.set(hookName, [])
      capture.typedHooks.get(hookName)!.push(handler as Function)
    },
    registerService: (s: any) => capture.services.push(s),
    registerTool: (t: any, opts?: any) => capture.tools.push({ tool: t, opts }),
    registerCommand: (c: any) => capture.commands.push(c),
    registerCli: (r: any, opts?: any) => capture.cliRegistrars.push({ registrar: r, opts }),
    registerHttpRoute: (p: any) => capture.httpRoutes.push(p),
    resolvePath: (p: string) => p,
  }

  return { api, capture }
}
```

## Commit
`feat(plugin): scaffold + manifest + entry + mock API factory`
