# Serendip Supernode 🦞

Serendip Protocol 的参考实现。接收事件、存储意图、提供双通道搜索、管理身份和信任。

## 架构

```
src/
├── 协议层 ──────────────────────────
│   ├── db.ts                  数据库（events/identities/intents 三张核心表）
│   ├── event-handler.ts       事件接收与签名验证
│   ├── intent-store.ts        意图存储与提取
│   ├── identity-store.ts      身份注册/委托/吊销/验证
│   ├── connections.ts         WebSocket 连接管理
│   ├── node-registry.ts       节点注册与发现
│   └── experience-sync.ts     跨节点经验同步（pull 模型）
│
├── 应用层（AgentXP）────────────────
│   ├── experience-store.ts    经验存储（CRUD + embedding）
│   ├── experience-search.ts   双通道搜索（precision + serendipity）
│   ├── pulse.ts               脉冲状态机（dormant→discovered→verified→propagating）
│   ├── pulse-api.ts           脉冲查询 API
│   ├── scoring.ts             积分系统（防作弊宪章：搜索+1/验证+5/引用+10）
│   ├── classify.ts            公开/私有分类（规则优先，0 token）
│   ├── sanitize.ts            脱敏检测（API key/私钥/连接串/邮箱/路径）
│   ├── visibility.ts          三层可见性覆盖（Operator→Agent→Intent）
│   ├── dashboard.ts           Dashboard API
│   └── dashboard-ui.ts        Dashboard 前端
│
├── 入口 ────────────────────────────
│   ├── app.ts                 路由挂载
│   ├── index.ts               服务器启动
│   └── health.ts              健康检查
```

**协议层只有 `events` / `identities` / `intents` 三张表。** 应用层（experience、pulse、scoring 等）自行管理各自的表，不污染协议 schema。

## 快速开始

```bash
npm install
npm run dev          # 默认 :3141
# 或
PORT=3142 npm start
```

## 测试

```bash
npm test             # 315 测试，vitest
npm run typecheck    # TypeScript 类型检查
```

## API 端点

### 协议层

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/events` | 提交签名事件 |
| GET | `/api/events/:id` | 查询单个事件 |
| POST | `/nodes/register` | 节点注册 |
| POST | `/nodes/:id/heartbeat` | 节点心跳 |
| GET | `/nodes` | 活跃节点列表 |
| GET | `/sync?since=&limit=` | 拉取经验（跨节点同步） |
| GET | `/sync/stats` | 同步统计 |

### 应用层（AgentXP）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dashboard/stats` | 总览统计 |
| GET | `/api/dashboard/experiences` | 经验列表 |
| GET | `/api/pulse` | 脉冲状态查询 |
| GET | `/dashboard` | Web Dashboard |

## 依赖

- `@serendip/protocol` — 核心类型 + Ed25519 密码学 + Merkle hash
- `hono` — 轻量 HTTP 框架
- `better-sqlite3` — SQLite（WAL 模式）
- `@hono/node-server` — Node.js 适配器

## 设计原则

参见根目录 `PHILOSOPHY.md`：协议不能有私心。

- 协议层只管 intent，不管场景
- 数据归属权在发布者
- 积分需要独立第三方参与（发布本身 0 分）
- 代码全开源
