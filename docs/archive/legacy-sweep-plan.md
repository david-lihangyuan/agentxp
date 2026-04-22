# Legacy Sweep Plan

> BOOTSTRAP §3 第 0.5 步产出。用户确认后才会执行 `git mv`。
> 提交消息统一为 `chore: archive legacy docs & rules to legacy/ before BOOTSTRAP`。

---

## A. 归档（确定）—— 旧设计 / 计划 / 协议 / 数据快照

| # | 源路径 | 目标路径 | 理由 |
|---|---|---|---|
| A1 | `docs/plans/` (整个目录：13 个顶层 md + `plugin-v2/` 19 个 md) | `legacy/docs/plans/` | Phase A-I TDD spec、v4 design、plugin v2/v3 设计——BOOTSTRAP §2 点名的"思考笔记" |
| A2 | `docs/spec/serendip-protocol-v1.md` | `legacy/docs/spec/serendip-protocol-v1.md` | BOOTSTRAP 第 3 步要在 `docs/spec/` 下生成 00~05，必须先腾位置 |
| A3 | `docs/zh/` (2 个 md + 2 个 pdf) | `legacy/docs/zh/` | 旧设计文档和协议规范的中文版 |
| A4 | `docs/plugin-v3-test-report.md` | `legacy/docs/plugin-v3-test-report.md` | plugin-v3 测试报告，杂记类 |
| A5 | 根目录 6 个 UUID `.md` 文件（`18829805-*` / `aa0dcdd1-*` / `aa3d3d78-*` / `b33cfc1b-*` / `bd1ec428-*` / `f6359a96-*`） | `legacy/<原名>` | `head` 确认：都是 v2/v3/v4 设计文档的副本，有重复内容（同一份在两个 UUID 里），疑似某工具批量导出的备份 |

**A 小计**：5 项，归档后原路径清空。

---

## B. 归档（确定）—— Agent 规则类资产（其他工具用的，不影响 Augment）

| # | 源路径 | 目标路径 | 理由 |
|---|---|---|---|
| B1 | `CLAUDE.md` (根目录) | `legacy/CLAUDE.md` | Claude Code 的项目约定。搬走后原路径对 Claude Code 不再生效；**内容（技术栈/代码规范/分支策略等）在第 3 步生成 SPEC 时会被重新消化进 `docs/spec/`**；长期约束会在 §5 重建到 `.augment/rules/project.md`。Augment 不读 `CLAUDE.md`（读 `.augment/rules/`），搬走对当前会话无影响 |
| B2 | `.claude/agents/gstack.md`、`.claude/agents/superpowers.md` | `legacy/.claude/agents/` | Claude Code 的 agent 定义。Augment 不读 `.claude/`。搬走不影响 superpowers/gstack 在 Augment 的可用性（因为 Augment 走的是 `~/.superpowers/bin/sp` 和 `~/.agent-skills/`，由 `.augment/rules/*` 指引）|

**B 小计**：2 项。

---

## C. 保留（不归档）—— BOOTSTRAP 明确不扫，或当前工作必需

| 路径 | 理由 |
|---|---|
| `BOOTSTRAP.md` | BOOTSTRAP 自己规定不归档（§5 毕业后再归到 `docs/archive/`） |
| `README.md`、`LICENSE`（若有）、`CHANGELOG.md`、`CONTRIBUTING.md` | BOOTSTRAP §0.5 明确白名单 |
| `.github/ISSUE_TEMPLATE/sip.md`、其余 `.github/` | BOOTSTRAP 明确不动 CI/CD |
| `.gitignore`、`bun.lock`、`package.json` / `package-lock.json` / `tsconfig.*` | manifest，明确不动 |
| `.augment/rules/superpowers.md` | **Augment 当前会话依赖**（调用 `~/.superpowers/`）。不是"BOOTSTRAP 之前的历史资产"，是工作中规则 |
| `.augment/rules/agent-skills.md` | **刚在第 0 步创建**（让 `~/.agent-skills/` 可被发现）。§5 毕业时会和 `project.md` 并存 |
| `supernode/`、`packages/`、`scripts/`、`tests/`、`kind-registry/` | 源代码目录，BOOTSTRAP 明确不归档 |
| `packages/skill/SKILL.md`、`packages/skill-hermes/SKILL.md`、`packages/skill/templates/*.md`、`packages/*/README.md`、`kind-registry/README.md` | 跟随代码的 README / SKILL 定义，属于代码资产 |
| `node_modules/`、`output-pdfs/`、`.DS_Store` | 构建/临时产物 |

---

## D. 边界模糊（请你确认，每项回 `搬` / `留` / `跳过(以后再说)`）

| # | 路径 | 内容 | 我的推荐 |
|---|---|---|---|
| D1 | `docs/all-experiences-export.md` + `docs/all-experiences-export-zh.md` + 两份同名 `.pdf` | 经验数据导出快照（约 60-65KB 文本 + 1.6MB PDF） | **搬** → `legacy/docs/` — 是产品数据快照，不是 SPEC 工作输入 |
| D2 | `docs/ops/2026-04-18-feedback-loop-rollout.md` | 今天（2026-04-18）的运维 rollout 记录，看起来是近期在用的运营文档 | **留** — BOOTSTRAP §0.5 扫描范围里没有 `docs/ops/`，且属于"正在用"的运营文档 |
| D3 | `agents/coding-01/*.md`（`AGENTS.md` / `BOUNDARY.md` / `CURIOSITY.md` / `HEARTBEAT.md` / `SOUL.md` + `memory/heartbeat-chain.md`） | 单个 agent 实例的人格/边界配置 + 运行时记忆链 | **留** — 这些是 agent 实例的配置数据，跟 `agents/coding-01/scripts/` 代码绑定，属于代码+数据层，不是历史设计笔记 |
| D4 | `agents/templates/*.md`（同样 4 个 + 子目录） | Agent 实例模板（创建新 agent 时的 scaffolding） | **留** — 同 D3，属于代码层模板 |
| D5 | `agents/coding-01/AGENTS.md` 特殊标注 | BOOTSTRAP §0.5 扫描清单点名了"根目录 `AGENTS.md`"，此处是 `agents/coding-01/AGENTS.md`（子路径） | 我读的是"根目录 AGENTS.md"这一项针对的是项目级 agent 规则。子路径下的 AGENTS.md 是 agent 实例的人格文件，不是项目级规则——倾向**留** |

---

## E. 执行计划（用户确认后按此运行）

```bash
# 1. 建 legacy/ 骨架（git mv 会自动创建父目录，此步可选）
mkdir -p legacy

# 2. A 组（6 条 git mv）
git mv docs/plans legacy/docs/plans
git mv docs/spec/serendip-protocol-v1.md legacy/docs/spec/serendip-protocol-v1.md
git mv docs/zh legacy/docs/zh
git mv docs/plugin-v3-test-report.md legacy/docs/plugin-v3-test-report.md
for f in 18829805-*.md aa0dcdd1-*.md aa3d3d78-*.md b33cfc1b-*.md bd1ec428-*.md f6359a96-*.md; do git mv "$f" "legacy/$f"; done

# 3. B 组（2 条）
git mv CLAUDE.md legacy/CLAUDE.md
git mv .claude/agents legacy/.claude/agents  # 保留整个 .claude/agents/ 结构

# 4. D 组 —— 按你的回答决定

# 5. 写 legacy/README.md 一行索引
cat > legacy/README.md <<'EOF'
# Legacy archive

Archived on 2026-04-18 by BOOTSTRAP.md initialization.
Original paths are preserved under legacy/<original-path>.
See docs/legacy-sweep-plan.md for the full rationale.
EOF

# 6. 单次提交
git add -A
git commit -m "chore: archive legacy docs & rules to legacy/ before BOOTSTRAP"
```

**注意**：仓库当前状态下 `git status` 显示所有根目录 md（BOOTSTRAP.md、6 个 UUID md 等）、`.augment/`、`.claude/`、`.DS_Store` 全是**未跟踪**（`??`）。这意味着 `git mv` 对这些文件会失败——它们没在 git 里。我会自动改用 `mkdir -p legacy/<dir> && mv <src> legacy/<src>`（非 git 移动）对未跟踪文件；已跟踪的走 `git mv`。执行前我会先 `git status` 一次确认每个源路径的跟踪状态，然后选对应命令。

---

## 请你回复

1. **A + B 组：全部执行** —— 回 `y`，或指出哪一条要改
2. **D1 ~ D5**：逐项回答 `搬` / `留` / `跳过`（或一句话"D1 搬，其余留"这种简写也行）
3. 有没有我漏扫的路径？你现在扫一眼仓库根目录，如果有我没列出来的散落文件，告诉我

确认后我开始执行，完成后报告结果并进入第 1 步（调研）。
