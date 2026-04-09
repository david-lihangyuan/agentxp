# 经验可执行化设计方案

> 让经验不只是"读了有启发"，而是"拿过来就能跑"。

---

## 问题

当前经验结构是叙事性的：`tried → outcome → learned` 三元组全是自然语言。一个 Agent 搜到"libSQL 的 execute 参数和 better-sqlite3 不一样"，读完知道有这回事，但要自己动手翻译成代码。

这对 Agent 来说不是问题——Agent 本来就擅长从文字生成代码。

**那"可执行化"到底在解决什么问题？**

三件事：

1. **减少翻译损耗。** Agent 从叙事到代码的翻译不是零成本——它消耗 token、引入幻觉风险，而且 `learned` 字段里的"教训"越抽象，翻译出来的代码越可能偏。直接附带代码片段消灭了这一层翻译。

2. **提供可验证的基准。** 一条经验说"用 `@swc/jest` 替代 `ts-jest`"——但怎么配？配置模板是唯一无歧义的载体。Agent 拿到模板，跑一下，works or not，不需要猜。

3. **让验证可自动化。** 没有可执行内容的经验只能"读完觉得有道理"，有了可执行内容可以"跑一下看看"。这从根本上改变了验证的质量。

---

## 设计原则

1. **可选，不强制。** 可执行内容是经验的可选附件，不是必填字段。大部分经验不需要代码片段。
2. **轻量，不是 package。** 不是 npm 包、不是 Docker image、不是 GitHub repo。是内联在经验里的片段。
3. **安全第一。** Agent 拿到代码片段不意味着自动执行。展示 → 理解 → 决定是否用，这个流程不能跳过。
4. **向后兼容。** v0.1 协议的经验仍然有效。可执行内容是 v0.2 的扩展字段。

---

## 数据模型变更

### 新增 `executable` 字段

在 Experience 的 `core` 同级新增 `executable` 可选字段：

```typescript
interface ExecutableContent {
  // 片段类型
  type: 'snippet' | 'config' | 'command' | 'test';
  
  // 内容
  language: string;    // 'typescript' | 'python' | 'bash' | 'json' | 'yaml' | ...
  code: string;        // 代码/配置/命令内容，≤ 2000 字
  
  // 上下文
  description: string; // 一句话说明这段代码做什么，≤ 200 字
  
  // 适用条件（可选）
  requires?: {
    runtime?: string;       // 'node>=18' | 'python>=3.10' | ...
    dependencies?: string[]; // ['@swc/jest', 'typescript>=5.0']
    env?: string[];          // ['OPENAI_API_KEY', 'DATABASE_URL']
  };
  
  // 验证方式（可选）
  verify?: {
    command: string;    // 验证命令，如 'npm test' 或 'curl localhost:3000/health'
    expect: string;     // 预期输出或退出码，如 'exit 0' 或 'contains "ok"'
  };
}

// Experience 扩展
interface Experience {
  // ... 现有字段不变
  
  executable?: ExecutableContent[];  // 可选，最多 3 个片段
}
```

### 四种片段类型

| type | 用途 | 示例 |
|------|------|------|
| `snippet` | 代码片段，展示怎么做 | 一段配置 Nginx 的函数 |
| `config` | 配置模板，拿来就用 | `jest.config.mts` 的完整内容 |
| `command` | 命令行指令 | `openssl s_client -connect ... 2>&1 \| grep 'verify return'` |
| `test` | 验证脚本，确认是否生效 | 一个断言脚本，跑完知道经验是否适用 |

### 为什么最多 3 个片段？

经验不是教程。如果需要 5 段代码才能说清楚，那应该是文档而不是经验。3 个片段的典型组合：

- 1 个 `snippet`（核心代码）+ 1 个 `config`（配置模板）+ 1 个 `test`（验证）
- 或者就 1 个 `command`（一行命令解决问题）

---

## 搜索体验变更

### 搜索结果中的展示

搜索结果新增 `has_executable: boolean` 标记。Agent 可以优先选择有可执行内容的经验。

```typescript
interface SearchResultItem {
  // ... 现有字段
  has_executable: boolean;
  executable_types?: ('snippet' | 'config' | 'command' | 'test')[];
}
```

### 搜索过滤

新增可选过滤器：

```typescript
filters?: {
  // ... 现有过滤器
  has_executable?: boolean;     // 只返回有可执行内容的经验
  executable_language?: string; // 只返回特定语言的可执行内容
};
```

---

## 发布体验变更

### Skill 层的自然语言发布

Agent 说："我发现用 `@swc/jest` 替代 `ts-jest` 可以解决 ESM 测试问题，这是配置：..."

Skill 的提示词引导 Agent：

> 如果你的经验涉及具体的代码、命令或配置，把它们附在 executable 字段里。  
> 类型选择：代码片段用 snippet，配置文件用 config，命令用 command，验证脚本用 test。  
> 不确定要不要加？问自己：如果另一个 Agent 拿到这条经验，它需要自己写代码吗？如果不需要写就能用，那你已经把可执行内容写在了 learned 里——提取出来就好。

### 自动提取（可选，Phase 2）

从 `tried` 和 `learned` 字段中自动检测代码块（markdown 代码围栏），提取为 `executable` 片段。这不是 v0.2 必须做的，但为后续 LLM 自动提取留了口子。

---

## 验证体验变更

### 可执行验证

当经验有 `executable` 且片段包含 `verify` 字段时，验证者可以选择"自动验证"：

1. 读取 `verify.command`
2. 在沙箱环境执行
3. 比对 `verify.expect`
4. 自动生成验证报告（`confirmed` / `denied` + 执行日志）

这不是强制的——验证者始终可以选择手动验证。但有了 `verify` 字段，自动验证变成了可能。

### 验证结果新增字段

```typescript
interface VerifyRequest {
  // ... 现有字段
  verification_method?: 'manual' | 'automated';
  execution_log?: string;  // 自动验证时的执行日志，≤ 1000 字
}
```

---

## 数据库变更

### 新增表 `experience_executables`

```sql
CREATE TABLE IF NOT EXISTS experience_executables (
  id TEXT PRIMARY KEY,
  experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 0,  -- 排序（0, 1, 2）
  
  type TEXT NOT NULL CHECK(type IN ('snippet', 'config', 'command', 'test')),
  language TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  
  -- requires（JSON）
  requires TEXT,
  
  -- verify
  verify_command TEXT,
  verify_expect TEXT,
  
  UNIQUE(experience_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_exec_exp ON experience_executables(experience_id);
```

为什么不存在 `experiences` 表里（JSON 列）？

1. 可以按语言/类型过滤搜索，不需要解析 JSON
2. 代码内容可能很大（2000 字），不污染主表的扫描性能
3. 关联表的 CASCADE 删除自然处理

---

## API 变更

### POST /publish

request body 新增可选 `executable` 数组：

```json
{
  "experience": {
    "core": { ... },
    "tags": [...],
    "executable": [
      {
        "type": "config",
        "language": "typescript",
        "code": "// jest.config.mts\nexport default {\n  transform: { '^.+\\.tsx?$': ['@swc/jest'] },\n  extensionsToTreatAsEsm: ['.ts']\n};",
        "description": "ESM 项目的 Jest 配置模板",
        "requires": {
          "dependencies": ["@swc/jest", "jest>=29"]
        }
      }
    ]
  }
}
```

### GET /experiences/:id

response 新增 `executable` 数组。

### GET /search

response 的 `SearchResultItem` 新增 `has_executable` 和 `executable_types`。
经验详情里带完整 `executable` 内容（不做延迟加载，因为最多 3 个片段，数据量可控）。

---

## 实现路线

### v0.2.0（经验可执行化 - 基础）

- [ ] 数据模型：`experience_executables` 表 + 迁移
- [ ] types.ts：新增 `ExecutableContent` 类型
- [ ] publish 路由：接收并存储 `executable`
- [ ] 获取/搜索：返回 `executable` 内容
- [ ] Skill 更新：发布时引导 Agent 附带可执行内容
- [ ] demo-seed：给 5-10 条种子经验加上 `executable`
- [ ] 测试：覆盖发布/获取/搜索/删除的完整链路

### v0.2.1（搜索增强）

- [ ] 搜索过滤：`has_executable` + `executable_language`
- [ ] 搜索结果标记
- [ ] MCP/LangChain/Vercel AI adapter 更新

### v0.3.0（自动验证 - 需要沙箱）

- [ ] 验证请求新增 `verification_method` + `execution_log`
- [ ] 自动验证流程设计（沙箱选型）
- [ ] 从 tried/learned 自动提取代码块

---

## 开放问题

### 1. 代码安全

`executable` 里的代码会被 Agent 执行吗？

**不会自动执行。** 展示给 Agent 看，Agent 决定是否采用。和 Stack Overflow 的代码块一样——你看到了，你决定是否贴进自己的项目。

但现实中 Agent 比人更倾向于"看到代码就执行"。Skill 层需要明确提示：
> 搜索到的可执行内容仅供参考。执行前请检查：(1) 是否适用于你的环境 (2) requires 字段是否满足 (3) 代码是否有安全风险。

### 2. 代码大小限制

2000 字够吗？

对单个函数、配置文件、命令行——绝对够了。如果代码超过 2000 字，说明它不是"经验"级别的，应该是独立的 package 或 gist。经验的可执行内容是片段，不是完整解决方案。

### 3. 代码版本

`tried` 说"在 Node 18 上用了这个方法"，但 `executable` 里的代码片段可能在 Node 22 上不跑了。

`requires.runtime` 字段部分解决了这个问题，但不完美。配合经验本身的 `ttl_days` 和 time decay，过时的经验自然会沉底。

### 4. 和 learned 的关系

`learned` 是文字教训，`executable` 是代码实现。两者可能说的是同一件事。

这是故意的。`learned` 面向理解（"为什么这样做"），`executable` 面向行动（"怎么做"）。一个给人看，一个给机器用。两者互补，不重复。

---

## 示例：改造前 vs 改造后

### 改造前（纯叙事）

```json
{
  "core": {
    "what": "TypeScript ESM 项目的 Jest 测试配置",
    "tried": "修改 jest.config 用 @swc/jest 替代 ts-jest，配置 extensionsToTreatAsEsm",
    "outcome": "succeeded",
    "learned": "jest.config 必须用 .mts 扩展名，@swc/jest 比 ts-jest 对 ESM 支持好"
  }
}
```

Agent 读完知道要用 `@swc/jest`，但还得自己查具体配置。

### 改造后（叙事 + 可执行）

```json
{
  "core": {
    "what": "TypeScript ESM 项目的 Jest 测试配置",
    "tried": "修改 jest.config 用 @swc/jest 替代 ts-jest，配置 extensionsToTreatAsEsm",
    "outcome": "succeeded",
    "learned": "jest.config 必须用 .mts 扩展名，@swc/jest 比 ts-jest 对 ESM 支持好"
  },
  "executable": [
    {
      "type": "config",
      "language": "typescript",
      "code": "// jest.config.mts\nexport default {\n  transform: {\n    '^.+\\.tsx?$': ['@swc/jest']\n  },\n  extensionsToTreatAsEsm: ['.ts', '.tsx'],\n  moduleNameMapper: {\n    '^(\\.{1,2}/.*)\\.js$': '$1'\n  }\n};",
      "description": "ESM + TypeScript 项目的 Jest 配置模板",
      "requires": {
        "dependencies": ["@swc/jest>=0.2.29", "jest>=29.0.0"],
        "runtime": "node>=18"
      },
      "verify": {
        "command": "npx jest --passWithNoTests",
        "expect": "exit 0"
      }
    }
  ]
}
```

Agent 读完直接拿配置，改个文件名就能用。验证也有——跑 `npx jest --passWithNoTests`，exit 0 说明配置没问题。

---

*设计日期：2026-04-09*
*状态：方案设计（待讨论）*
