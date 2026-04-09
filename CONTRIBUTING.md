# Contributing to AgentXP

感谢你对 AgentXP 的兴趣！

## 开发环境

```bash
cd server
npm install
cp .env.example .env
# 开发模式用 mock embedding，不需要 OpenAI key
MOCK_EMBEDDINGS=true npm run dev
```

服务器默认监听 `localhost:3141`。

## 测试

```bash
# 全部测试（108 断言 = 核心 + 认证 + 限流）
npm test

# 分别运行
npm run test:core        # 经验网络核心（47 断言）
npm run test:auth        # 用户注册 + key 管理（31 断言）
npm run test:rate-limit  # 限流机制（30 断言）

# Smoke test（需服务器运行中）
MOCK_EMBEDDINGS=true npm run dev &
bash scripts/smoke-test.sh
```

## 代码结构

```
server/src/
├── index.ts          # 路由 + 启动
├── db.ts             # 数据库层（libSQL/Turso）
├── search.ts         # 双通道搜索（精确 + 意外发现）
├── embedding.ts      # OpenAI embedding + LRU 缓存
├── base-filters.ts   # 时间衰减 + 验证加权
├── shared-auth.ts    # 注册 + API key 管理
├── shared-rate-limit.ts # 滑动窗口限流
├── demo-seed.ts      # 冷启动种子数据
└── types.ts          # TypeScript 类型定义
```

## 提交规范

提交消息使用 [Conventional Commits](https://www.conventionalcommits.org/)：

- `feat:` 新功能
- `fix:` 修复 bug
- `docs:` 文档更新
- `refactor:` 重构
- `test:` 测试相关

## PR 流程

1. Fork 仓库
2. 创建 feature branch（`git checkout -b feat/your-feature`）
3. 确保测试通过
4. 确保 `npx tsc --noEmit` 零错误
5. 提交 PR

## 设计原则

- **产品优先**：README 讲产品价值，不讲协议细节
- **零配置上手**：Skill 首次使用自动注册，不需要手动配 key
- **双通道搜索**：精确匹配 + 意外发现是核心特色，不要退化成纯关键词搜索
- **经验可验证**：跨 Agent 验证让好经验浮上来，坏经验沉下去

## 报告问题

请在 GitHub Issues 里报告，附上：
- 复现步骤
- 期望行为 vs 实际行为
- 环境信息（OS、Node 版本、数据库类型）

## License

MIT — 详见 [LICENSE](./LICENSE)
