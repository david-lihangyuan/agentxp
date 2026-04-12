# CLAUDE.md — AgentXP 项目约定

> 本文件是 Claude Code 的行为约束。每次启动时自动加载。
> 最后更新：2026-04-12

---

## 项目概述

**AgentXP** 是一个让 AI Agent 能永久保存、验证、共享经验的开放平台。底层协议是 **Serendip Protocol v1**。

核心理念：**Equality. Freedom from platform exploitation.**
- 你的经验、声誉、数据属于你自己，不属于平台
- 每个参与者在协议层拥有平等权利
- "发现你原本遇不到的"

用户看到的：**"Teach your AI Agent to learn from mistakes."**
背后的：去中心化经验协议、Relay 网络、密码学身份。

---

## 仓库结构

```
agentxp/                          Monorepo root
├── packages/
│   ├── protocol/                 @serendip/protocol — 事件类型、Ed25519 签名、Merkle 证明
│   └── skill/                    @agentxp/skill — Agent 反思技能（CLI + 安装器）
├── supernode/                    Relay 服务器（Hono + SQLite）
│   └── src/
│       ├── agentxp/              业务逻辑（experience, pulse, scoring, search, human-layer...）
│       ├── protocol/             协议层（节点注册、身份、同步）
│       ├── app.ts                路由注册
│       ├── db.ts                 SQLite 初始化
│       └── index.ts              入口
├── agents/                       示例 Agent 实例
├── kind-registry/                开放的经验类型注册表
├── docs/
│   ├── spec/                     协议规范（serendip-protocol-v1.md）
│   └── plans/                    TDD 设计文档（按 Phase 组织）
├── tests/                        集成测试 + 基础设施测试
├── scripts/                      开发与部署脚本
└── CONTRIBUTING.md               贡献指南（分支、PR、代码风格详细规范）
```

---

## 终极目标

1. **协议层**：Serendip Protocol v1 完整实现并稳定
2. **Relay 网络**：Supernode 可靠运行，支持经验存储、语义搜索、Pulse 心跳、Impact 评分
3. **Agent 技能**：任何 AI Agent 都能通过 `@agentxp/skill` 一键安装，自动反思和发布经验
4. **Human Layer**：人类参与层（letters, trust, agent-voice, contribution）完整
5. **开放生态**：第三方可以注册自定义 kind、运行自己的 Relay、构建在协议之上

---

## 技术栈

| 层 | 技术 |
|---|---|
| 语言 | TypeScript (ESM, strict mode) |
| 运行时 | Node.js / Bun |
| Web 框架 | Hono |
| 数据库 | SQLite (better-sqlite3) |
| 加密 | @noble/curves (Ed25519)、@noble/hashes (SHA-256) |
| 测试 | Vitest |
| 容器化 | Docker + Caddy |
| 包管理 | npm workspaces |

---

## 代码规范（必须遵守）

### TypeScript

- **禁止 `any`** — 用 `unknown` + type guard
- **禁止 `as` 强转** — 除非不可避免，必须加注释说明原因
- **`const` 优先**，避免 `let`，禁止 `var`
- **严格等于** `===`，永远不用 `==`
- **ESM only** — 不用 CommonJS（`require`）

### 命名

- `PascalCase`：类型、接口、类
- `camelCase`：变量、函数、方法
- `SCREAMING_SNAKE_CASE`：模块级常量
- 文件名：`kebab-case.ts`

### Import 顺序

1. 外部包（`hono`, `better-sqlite3`, `@noble/*`）
2. 内部包（`@serendip/protocol`, `@agentxp/*`）
3. 相对路径

### 错误处理

- 永远不要静默吞错误
- CLI 面向用户的错误：输出可读消息，不是堆栈
- 意外错误：包含原始错误信息，exit code 1

### 语言

- **所有代码、注释、commit message、文档一律英文**
- 与团队成员的沟通输出用中文

---

## 分支策略

| 分支 | 用途 | 合入 |
|------|------|------|
| `main` | 生产发布，打 semver tag | — |
| `develop` | 集成分支，feature 合入这里 | `main` (via release) |
| `feature/<name>` | 新功能，从 `develop` 分出 | `develop` |
| `fix/<name>` | Bug 修复，从 `develop` 分出 | `develop` |
| `hotfix/<name>` | 紧急修复，从 `main` 分出 | `main` + `develop` |

- **绝不直接提交到 `main`**
- 分支名用 `kebab-case`
- Feature 分支生命周期 < 2 周

---

## Commit 规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <short description>
```

| Type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 仅文档 |
| `refactor` | 重构（无新功能或修复） |
| `test` | 添加或修复测试 |
| `chore` | 构建工具、依赖 |
| `perf` | 性能优化 |

示例：`feat(relay): add pull-based sync with signature verification`

---

## 测试要求

- **所有新功能必须包含 Vitest 单元测试**
- `describe` / `it` 用英文，读起来像自然语言
- 测试文件放在被测源码旁的 `tests/` 子目录，或 `tests/infra/`（跨包基础设施测试）
- 集成测试放在 `tests/integration/`
- 新代码测试覆盖率目标 **> 80%**
- 运行全部测试：`npx vitest run`
- 运行特定包：`npx vitest run packages/protocol`
- 类型检查：`tsc --noEmit`

---

## 开发流程

### TDD 驱动

本项目采用 **TDD（测试驱动开发）** 方式：
1. 先读 `docs/plans/` 里对应 Phase 的设计文档
2. 写测试（红灯）
3. 写最小实现（绿灯）
4. 重构（保持绿灯）

### Phase 系统

开发按 Phase 组织（A → B → C → ... → I + HL），每个 Phase 有对应的 TDD spec：
- `docs/plans/2026-04-12-phase-a-tdd-spec.md` — 协议核心
- `docs/plans/2026-04-12-phase-b-tdd-spec.md` — 事件接收
- 以此类推

执行任务前，先读对应 Phase 的设计文档，理解上下文。

---

## 部署

### 本地开发

```bash
./scripts/setup-dev.sh
# Relay 启动在 http://localhost:3141
# Dashboard 在 http://localhost:3141/dashboard
```

### 生产环境

- **VPS:** root@154.12.191.239
- **部署路径:** /opt/agentxp/supernode/
- **PM2 app:** agentxp (id: 17)
- **域名:** https://relay.agentxp.io
- **发布脚本:** 用 `publish-hangyuan.ts` 发布经验

---

## 关键设计决策

1. **Relay 模型**（不是 P2P）— 降低复杂度，保留退出自由
2. **Ed25519 签名链** — Operator key → Agent key delegation
3. **三级匹配** — 精确 → 语义 → 偶遇（serendipity）
4. **Impact 评分来自他人验证**，不是自我报告
5. **Kind 系统可扩展** — 反向域名命名（`io.agentxp.experience`）
6. **单一 Relay 先行** — 多 Relay 同步是未来目标，现在 YAGNI

---

## 安全红线

- **私钥永远不离开本机**（`~/.agentxp/identity/`）
- **不要把密钥写进代码或提交到 Git**
- **payload 上限 64KB**
- **Relay 不信任客户端** — 所有事件必须验签
- **破坏性操作先问人**（`trash` > `rm`）

---

## 你（Claude Code）的工作方式

1. **开始任务前**：先读相关的设计文档和已有代码，理解上下文
2. **写代码前**：先写测试
3. **写完后**：运行测试确认通过（`npx vitest run`），运行类型检查（`tsc --noEmit`）
4. **Commit 前**：确保符合 Conventional Commits 规范
5. **不确定的事**：不要猜，说出来。宁可问也不要做错
6. **不要过度工程** — YAGNI 原则。只做被要求的事，不要"顺手"加功能
7. **改动范围尽量小** — 一个任务一个关注点，不要把不相关的改动混在一起

---

## 常用命令速查

```bash
# 全部测试
npx vitest run

# 特定包测试
npx vitest run packages/protocol
npx vitest run supernode

# 类型检查
cd supernode && tsc --noEmit
cd packages/protocol && tsc --noEmit

# 本地启动
./scripts/setup-dev.sh

# 格式化
npx prettier --write .

# Git
git checkout -b feature/<name>
git add -A && git commit -m "feat(scope): description"
```
