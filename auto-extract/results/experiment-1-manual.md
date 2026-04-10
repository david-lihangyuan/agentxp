# 实验 1: 手动提取基准 (Ground Truth)

## 源 Transcript
Session: cdc4289a (数据丢失调查 + 修复)
大小: ~8KB 精简后

## 人工判断：应该提取出的经验

### 经验 1 (高价值 - 0.95)
```json
{
  "what": "scp 部署时覆盖了生产数据库，导致 87 条经验数据丢失",
  "context": "AgentXP 生产服务器（VPS），使用 SQLite 数据库，通过 scp 手动部署代码。本地有一份旧的数据库文件（35条），生产库已积累到122条。",
  "tried": "通过 SSH 进入生产服务器排查：检查 DB 文件 Birth time、PM2 日志中的经验数量变化轨迹（122→35 断崖）、对比本地和生产 DB 数据量。确认根因后实施三项防护。",
  "outcome": "succeeded",
  "outcome_detail": "确认根因为 scp 部署时连带传送了 data/experiences.db。三项修复已实施：1) deploy.sh 只传 .js/.d.ts 不碰 data/ 2) 生产 cron 每6小时 sqlite3 .backup 保留7天 3) .gitignore 排除 *.db。丢失数据不可恢复但可重新采集。",
  "learned": "手动 scp 部署时很容易意外覆盖数据文件。SQLite 生产数据库必须有独立的备份机制（cron + sqlite3 .backup），部署脚本必须显式排除数据目录。PM2 日志保留量很少（44行），如果不是恰好保留了关键数据就无法确认根因——日志持久化同样重要。",
  "tags": ["deployment", "sqlite", "data-loss", "scp", "backup", "production", "pm2"]
}
```

### 经验 2 (中等价值 - 0.75)
```json
{
  "what": "SQLite 生产数据库的 Birth time 可以精确定位数据库被重建/覆盖的时间",
  "context": "调查 AgentXP 生产服务器数据丢失原因时，需要确定数据库文件何时被替换。",
  "tried": "使用 stat 命令查看 experiences.db 的 Birth time，发现为 2026-04-10 01:22:52 UTC——这不是渐进性损坏而是整个文件被替换。",
  "outcome": "succeeded",
  "outcome_detail": "Birth time 精确指向了文件被覆盖的时间点，结合 PM2 日志中经验数量断崖式下降（122→35），完整还原了事件时间线。",
  "learned": "调查数据库数据丢失时，文件的 Birth time（不是 Modify time）能区分 '文件被替换' 和 '数据被删除'。这是定位 scp 覆盖类问题的关键证据。",
  "tags": ["debugging", "sqlite", "forensics", "data-loss"]
}
```

### 不应该提取的内容
- 读取文件/检查状态等常规操作
- heartbeat 流程本身（读 chain、更新日志）
- 写 mistakes.md / 更新 heartbeat-chain（这是日志记录，不是技术经验）

## 提取质量评估标准
1. **应提取 2 条** — 一条核心（scp 数据丢失），一条辅助（Birth time 调查技巧）
2. **不应超过 3 条** — 过度拆分会产生噪声
3. **标签应覆盖关键词** — deployment, sqlite, data-loss, backup
4. **learned 字段必须有真正的洞察** — 不能只是"问题解决了"
