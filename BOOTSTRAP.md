# BOOTSTRAP — 从思考笔记到工程规格

> **一次性引导文档**。使命是把现有思考笔记升格成可执行的工程规格，并把长期原则毕业到项目 rules。交付完成后本文档归档，不再使用。

> 这份文档同时写给两类读者：你（项目负责人）读 §1 + §2；你的 AI 助手（Augment Code）读 §3。

---

## §1 · 怎么用（30 秒）

1. 这份文件已经在仓库根目录。
2. 在仓库里打开 Augment Code，对它说：**"读 BOOTSTRAP.md 按它执行。"**

AI 会：

- **先**扫一遍你的仓库（代码 + 所有文档），产出一张"现状地图"给你看
- **然后**从地图里挑出 5-10 个必须你拍板的决策点，一次一个问你
- **最后**根据你的回答生成 `docs/spec/` 下的规格文档

**不懂某个技术概念也没关系**。AI 问问题之前会先确认你对相关概念熟不熟：熟悉直接选、听说过给你简短对比、不清楚先讲明白再给你推荐。你可以选"接受 AI 推荐 + 标记为临时决定"（标注清楚，日后可调整），或者"先跳过，待了解后再回来决定"。不会被强迫在不懂的情况下拍板。

随时可中断，进度自动保存。**现有文档和代码一字不改。**

---

## §2 · 为什么要做这件事

现有文档是**优秀的思考笔记**，不是**工程规格**。核心差别在于：**哲学主张有没有被翻译成可执行的机制**。

举个仓库里的真实例子——"反思触发"这个核心机制：

| 层面 | 思考笔记里的表述 | 工程规格需要的答案 |
|---|---|---|
| 时机 | "session 或 heartbeat 周期结束时" | session 结束 = CLI 退出 / N 分钟空闲 / 任务完成？选哪个 |
| 机制 | "agent 被提示暂停并反思" | prompt 注入（靠自觉）/ 强制 tool call / plugin 层 hook 直接写入？选哪个 |
| 主体 | "agent 写反思" | agent 写（第一人称）/ 框架写（结构化记录）/ 两者并存？选哪个 |

三个"选哪个"如果不拍板，不同模块会各选一种，最终集成时数据流、所有权、用户感知完全对不上。思考笔记允许这种多可能性并存（讨论阶段合理），工程规格必须把每个选项收敛成一个确定答案。

**其他同类问题**（都要在决策阶段收敛）：

- 架构基线：Skill（prompt 驱动）vs Plugin（代码级 hook）——v4 和 openclaw-plugin 各走一派，没有作废声明
- 核心概念层级：reflection / experience / lesson / mistake 四词并用，层级关系没明写
- MVP 边界：v1/v2/v3 三条时间线 + Phase A-I 和 Phase 1-5 两套阶段划分并存
- 外部接口（OpenClaw hooks、@serendip/protocol）只有描述，没有签名

这一层"把笔记推到规格"必须由你亲自拍板——决策点本身不多，但每一个都会影响十几个模块。这份文档是让 AI 协助你**高效完成这个决策过程**，而不是替你决策。

---

## §3 · 给 Augment 的执行指令

### 你的角色

资深技术顾问 + Socratic 提问者。目标**不是**"替用户写出 SPEC"，而是**"通过调研 + 提问帮用户自己发现 SPEC 应该长什么样"**。

### 强制准则（任何时候都不要违反）

1. **不替用户做架构决定**。所有涉及"选 A 还是选 B"的问题必须问用户。
2. **一次只问一个问题**。不要一次抛一串选项逼用户快速回答。
3. **每个回答都要收敛**。收到答案后用一句话复述："所以你的意思是 X，对吗？" 确认后才进下一题。
4. **允许"我不知道"**。用户卡住时提供 2-3 个候选 + 每个的后果，让他选；不要催。
5. **用词温和**。不要说 "乱/错/矛盾"。说 "两处描述不一致，想请你确认当前的意图。"
6. **过程可恢复**。每轮结束后更新 `docs/spec-in-progress.md`：已确认、在讨论、未决。
7. **现有文档和代码一字不改**。所有新增产物放在 `docs/spec/`、`docs/spec-survey.md`、`docs/spec-in-progress.md`、`docs/spec-knowledge-gaps.md`、根目录 `HISTORY.md`。
8. **判断用户能否回答，再决定怎么问**。用户可能不具备回答某个问题的技术背景。提问前先分类这个决策属于哪一类（见下），并按对应流程走，不要假设用户"应该懂"。
9. **对话漂移后必须回到原题**。用户追问、延伸讨论、跑题之后，每次答完他的问题都要**主动复述当前未决的决策点**并重新给选项，不能让一个决策悬着进入下一个话题。详见下方"回到原题"机制。

---

### 决策分级与知识差处理

用户可能是非技术或半技术背景。**每个决策点在问出口之前，先在心里打标签**：

| 类型 | 判定 | 处理方式 |
|---|---|---|
| **P-产品** | 这是产品/业务/体验决定（例："MVP 要不要包括 dashboard？"） | 直接问，用户能答 |
| **T-技术（有对应物）** | 是技术决策但有产品/业务影响（例："反思触发用 prompt 注入还是 plugin hook？"） | **先探深浅**，再按档位走（见下） |
| **P-纯技术** | 用户不关心的实现细节（例："SQLite 用 WAL 模式吗？"） | **不问用户**，AI 自己定合理默认，记录在 `04-deferred.md` 供后续审阅 |

**"T-技术（有对应物）"类型的提问模板**（必须用这个流程，不能直接抛选项）：

```
这个决策涉及 <概念>（简短 1 句说明）。
问你之前先确认一下你的背景：
  [A] 我熟悉 — 直接给我选项
  [B] 听说过、大致知道 — 给我 30 秒对比再选
  [C] 不太清楚 — 先讲清楚，再推荐我一个
```

**根据用户选择走不同分支**：

- **选 A**：直接给"选项 + 每个的后果"，让用户选。
- **选 B**：给 1 段对比（每个选项 2-3 句），讲关键差异，再给选项。
- **选 C**：
  1. 用非技术语言讲清楚这个概念是什么、为什么要选（1-2 段）
  2. 给出 **AI 推荐值 + 推荐理由 + 可能的反方意见**
  3. 提供三条路：
     - 接受推荐（标注"临时默认，日后可调整"，写入 ADR）
     - 自己拍一个（哪怕感性判断）
     - 延后决定（在 SPEC 里标 `TBD`，记入 `docs/spec-knowledge-gaps.md`，注明"待了解后再定"）

**关键规则 · 对话漂移后的"回到原题"机制**

用户理解一个技术概念时常会顺着问下去（"那 XX 是什么？" "如果选 A 会怎样？"）。这是好事，说明在吸收。**但每次答完用户的追问，必须主动回到当前未决的决策点**，不要让它漂走。

回答追问后的标准收尾模板：

> "明白。回到刚才要定的问题——
> **<当前决策点一句话复述>**
> 我的推荐还是 <A/B>，理由 <一句话>。
> 你想：
> &nbsp;&nbsp;(1) 接受推荐
> &nbsp;&nbsp;(2) 选另一个
> &nbsp;&nbsp;(3) 先延后
> &nbsp;&nbsp;(4) 还想了解别的"

**三条子规则**：

1. **永远复述待决问题**。哪怕聊跑题 10 分钟，回来时也要完整复述一遍原问题，不能只说"所以你决定吗？"。
2. **给出"还想了解别的"这个出口**。鼓励继续澄清，用户不必假装懂了就拍板。
3. **防无限循环**。用户第 3 次问明显跑题的问题时，温和提议"我们可以先选'延后'标记这个决策，继续把其他决定先定下来，回头再回来——你觉得呢？" 不强推，但给出退出死胡同的路。

**知识差清单 `docs/spec-knowledge-gaps.md`** 格式：

```markdown
# Knowledge Gaps

## <概念名>
- 为什么重要：<这个概念会影响哪些模块>
- 1 分钟说明：<非技术语言概述>
- 深入资源：<链接或书名/关键字>
- 当前状态：待学习 / 已理解 / 采纳 AI 默认 / 已延后
- 影响到的决策：<决策点编号>
```

这个清单**不阻塞 SPEC 生成**——用户可以边学边做，或者一直采纳默认值。它的作用是让用户知道自己有哪些盲点，避免"不知道自己不知道"。

**针对当前 agentxp 仓库，用户大概率会碰到以下概念**（提问时主动标记，降低用户认知负担）：

- OpenClaw plugin / hook 机制 — 代码在什么时机被触发、能做什么不能做什么
- "Skill" 在 OpenClaw 语境下的含义 — 提示词文件 vs 代码模块
- Ed25519 身份密钥、中继（relay）、pulse decay 等网络层概念
- SQLite vs markdown 作为持久层的取舍
- 反思触发的实现机制（prompt 注入 / 强制 tool call / plugin hook）

碰到这些概念时，**默认走 T-技术（有对应物）流程，不要假设用户懂**。

---

### 第 0 步 · 环境预检（先于一切其他动作）

在做任何事之前，**先确认以下 skills 是否可用**。它们分两档：

**必需（§3 流程本身依赖）**：无。§3 可以在零 skill 环境下完成。

**推荐增强（会显著提升质量）**：
- `superpowers/brainstorming` — Socratic 式需求澄清
- `superpowers/writing-skills` 中的规格写作模式

**§4 后续阶段依赖**：
- `superpowers/writing-plans`、`planning-and-task-breakdown`
- `superpowers/executing-plans`、`superpowers/test-driven-development`
- `superpowers/verification-before-completion`、`incremental-implementation`
- `code-review-and-quality`、`spec-driven-development`、`documentation-and-adrs`

**预检动作**：

1. 列出当前会话可用的 skills（通常在系统提示中有 `<available_skills>` 段）
2. 对照上面清单，找出缺失的项
3. 向用户汇报：

   ```
   环境预检：
     §3 流程：可以直接开始（无强依赖）
     §4 推荐 skills：<列出缺失的>

   选项：
     A. 先继续 §3（生成 SPEC），§4 阶段再补 skills
     B. 暂停，先去安装 / 启用上述 skills，再回来执行
     C. 继续但 §4 用通用推理替代（质量可能下降）

   你选哪个？
   ```

4. 用户选择前**不要**进入第 1 步。

---

### 第 0.5 步 · 遗留资产归档（在调研之前执行）

在调研之前，把仓库内**所有历史文档和 agent 规则类资产**搬到 `legacy/`，让调研和 SPEC 生成从干净目录开始。**代码不在本步骤归档**——代码归档由 §4.3 在 SPEC 验证后执行（此时才有数据判断哪些能复用）。

**扫描范围（归档）**：

- `docs/spec/`、`docs/adr/`、`docs/design/`、`docs/plan/`
- 根目录 `CLAUDE.md`、`AGENTS.md`、`.cursorrules`、`.windsurfrules`
- `.augment/rules/` 下已有的 `.md` 文件（如果有）
- `HISTORY.md`、`docs/spec-survey.md`、`docs/spec-in-progress.md` 如已存在
- 根目录散落的 `*.md`（`NOTES.md` / `TODO.md` / `ROADMAP.md` 等）——逐个列出问用户是搬是留

**不归档**：

- 源代码目录（`src/`、`lib/`、`tests/` 等）
- manifest（`package.json` / `Cargo.toml` / `pyproject.toml` 等）
- `README.md`、`LICENSE`、`CHANGELOG.md`
- `.gitignore`、`.github/`、其他 CI/CD 配置
- `BOOTSTRAP.md` 自身

**执行动作**：

1. 产出归档清单 `docs/legacy-sweep-plan.md`：
   - 每一项：源路径 → 目标路径（目标路径保持原结构，即 `legacy/<原路径>`）
   - 特殊项（`CLAUDE.md` / `AGENTS.md` / `.augment/rules/*`）单独标注：
     > "这是 agent 规则文件。搬到 legacy 后，原路径的指令在对应工具中不再生效；新 rules 将在 §5 阶段重建到 `.augment/rules/`。Augment Code 的规则识别路径是 `.augment/rules/`，如果原文件是给 Claude Code / Cursor 等其他工具用的，搬走不影响 Augment 当前行为。"
   - 边界模糊项逐个列出，标 `? 待用户确认`
2. 交给用户确认。用户说"执行"之前**不动任何文件**。
3. 确认后：
   - git 仓库：`git mv` 保留历史 → 单独一次提交，消息固定为
     `chore: archive legacy docs & rules to legacy/ before BOOTSTRAP`
   - 非 git：`cp -r` 后 `rm -rf` 原路径
4. 在 `legacy/README.md` 写一行索引：
   > "<时间> 因 BOOTSTRAP.md 初始化而归档，原路径参见目录结构。"
5. 后续第 1 步调研在"干净仓库"状态下执行，设计笔记从 `legacy/docs/design/` 和 `legacy/docs/plan/` 读取。

**核心原则**：归档是可逆的（`git revert` 或目录回搬），但归档前的用户确认不能跳过——这是用户进入后续流程的心理准入点。

---

### 第 1 步 · 调研（不要问用户，自己做）

进入提问流程之前，**必须**先完成仓库调研，产出 `docs/spec-survey.md`。目的：让后面的讨论建立在事实基础上，不是文档假设上。

**1.1 文档地图**

- 遍历所有 `.md` 文件（包括 README、docs/、根目录散落文件等）
- 按类型分组：设计文档 / 计划文档 / 操作手册 / 决策日志 / 杂记
- 每份用一句话概括主题 + 标注最后修改日期

**1.2 代码现状**

- 顶层目录结构、主要模块、使用的语言/框架
- 关键依赖（`package.json` / `Cargo.toml` / `pyproject.toml` 等）及版本
- 入口文件、当前能跑起来的最小流程是什么

**1.3 矛盾与空白**

- 同一主题在不同文档里的冲突陈述，注明出处
- 文档说有但代码里没实现的功能
- 代码里有但文档没说的决定
- 命名不一致（同一个概念在不同文档里叫不同名字）

**1.4 决策点清单**

- 从 1.3 中提炼 **5-10 个必须用户拍板** 的决策
- 每个决策点按如下结构写：

  ```
  ### 决策点 N: <简短标题>
  - 文档 A 说: <...>（来源: 路径+行号）
  - 文档 B / 代码说: <...>（来源: ...）
  - 为什么重要: <影响哪些下游模块>
  - 建议优先级: 高 / 中 / 低
  ```

**输出动作**：把 `docs/spec-survey.md` 写好后，**先发给用户看**，问一句："这张地图里的决策点列表你认可吗？有没有漏掉的、或者顺序要调的？" 用户确认后进入第 2 步。

---

### 第 2 步 · 决策对话（一问一答）

**提问顺序**：从第 1 步调研出来的决策点里，按"最基础、最影响其他决定"的顺序问。典型优先级（仅参考，不强制）：

```
一句话产品定义 > 架构基线 > MVP 范围 > 数据真相源
  > 外部依赖状态 > 每模块验收标准 > YAGNI 不做清单
```

**每题模板**：

> "【第 N 题 / 共 X 题】[类型标签] 关于 <决策点标题>：
> 我在 <文档 A> 看到 <描述 A>，在 <另一位置或代码> 看到 <描述 B>。这里需要你确认当前基准。"

**根据"决策分级与知识差处理"走对应分支**：

- P-产品 类：直接问选项
- T-技术 类：**先用 A/B/C 三档问用户对这个概念的熟悉度**，再按档位走
- P-纯技术 类：不要问用户，AI 自己定，记入 `04-deferred.md`

收到答案 → 复述确认 → 更新 `docs/spec-in-progress.md`（必要时同步更新 `docs/spec-knowledge-gaps.md`）→ 下一题。

---

### 第 3 步 · 生成规格

所有决策点收敛后，新建：

```
docs/spec/
  00-overview.md       一句话产品 + MVP 定义 + 基准架构 + 重写策略声明
  01-interfaces.md     外部接口签名(TS 类型)
  02-data-model.md     数据模型 DDL + 真相源说明
  03-modules.md        每模块 I/O / 错误 / ≥3 验收用例 / Legacy Reference
  04-deferred.md       YAGNI 清单 + 重启条件
  05-glossary.md       关键术语精确定义
HISTORY.md             旧文档中哪些章节已被新决定取代(保留原文不删)
```

**风格**：英文、RFC-style(MUST / SHOULD / MAY)、每份 ≤300 行、代码片段用 TypeScript、参考对标 Stripe API docs 的简洁度。

**对话语言**：与用户对话用**中文**，产出的规格文档用**英文**。

**00-overview.md 必须包含"Rewrite strategy"小节**，明写：

> "This SPEC supersedes all prior designs archived under `legacy/`. The default implementation strategy is **full rewrite** — new code in `src/` follows this SPEC verbatim; `legacy/src-v1/` is consulted as reference only and MUST NOT be imported or copied (except pure utilities approved per ADR). Rationale: the legacy implementation was based on undecided Skill/Plugin hybrid designs and is architecturally misaligned with this SPEC."

**03-modules.md 里每个 MVP 模块必须包含 `Legacy Reference` 字段**，格式：

```
### Module: <name>

- Legacy Reference:
  - Primary: `legacy/src-v1/<path>` — <one-line summary of original intent>
  - Related: `legacy/docs/design/<path>#<section>` — <key paragraph>
  - Key divergence from legacy: <the core difference between this SPEC and the legacy implementation; if none, write "N/A — greenfield module">
- Inputs / Outputs: ...
- Errors: ...
- Acceptance cases: ... (≥3)
```

如果某模块在 legacy 中**没有对应文件**（纯新模块），Primary 填 `none — greenfield` 并在 Key divergence 写 `N/A`。不能省略字段。

这个字段的目的：实施阶段 AI 必须**先读 legacy 对应文件理解原意图，再按新 SPEC 实现**，而不是凭空编或复制粘贴。

---

### 验收清单

- [ ] `docs/spec-survey.md` 存在且被用户明确确认
- [ ] `docs/spec/` 下 6 份文档存在
- [ ] 每个 MVP 模块 ≥3 个验收用例（1 正常 / 1 边界 / 1 错误）
- [ ] 所有外部依赖有明确接口签名，或明确标注"待提供 + 负责人"
- [ ] `HISTORY.md` 列出旧文档中哪些章节已被取代
- [ ] 现有**代码**一字未改（`git diff -- ':!legacy/' ':!docs/'` 为空；legacy/ 和 docs/ 的变更仅来自第 0.5 步归档和本次 SPEC 生成）
- [ ] 所有"采纳 AI 默认"的决策已在 ADR 或 `docs/spec-knowledge-gaps.md` 标注，用户知情
- [ ] `03-modules.md` 里每个 MVP 模块都有 `Legacy Reference` 字段（Primary / Related / Key divergence，缺项即视为未完成；无对应 legacy 的模块明写 `none — greenfield`）
- [ ] `00-overview.md` 包含 "Rewrite strategy" 小节，声明"整体重写 + legacy 仅作参考"
- [ ] **用户能口述 MVP 定义**，与 `00-overview.md` 描述一致

**最后一条最重要**——SPEC 里的 MVP 定义必须是用户自己说出来的，不是被 AI 诱导写上去的。复述不出来 = 前面对话没真正收敛 = 需要回去补。

**倒数第二条也重要**——如果用户因为不懂某个概念接受了 AI 推荐，这件事必须被**显式记录**，不能当成"用户决定的"。将来需要追责或调整时，ADR 和 knowledge-gaps 清单是唯一依据。

---

## §4 · SPEC 交付之后：下一步路线（也写给 Augment）

当 §3 完成、`docs/spec/` 六份文档齐备、`HISTORY.md` 写好、验收清单全部打勾之后，**主动**告诉用户进入下一阶段，并按下面的链路继续推进。不要等用户问"下一步干嘛"。

### 4.1 验证 SPEC 是否真的可执行（先做这一步）

开一个**全新的对话会话**，**只**加载 `docs/spec/` 下的文件（不要加载 `docs/design/` 里的旧思考笔记），扮演"第一次接触这个项目的工程师"，尝试回答：

> "如果要实现 `03-modules.md` 里的模块 X，我需要哪些澄清问题？"

- 能直接开写 → SPEC 合格，进入 4.2
- 仍需要回头查 design/ 或追问用户 → SPEC 未收敛，回到 §3 补齐对应模块

### 4.2 任务分解与实施（superpowers 链路）

推荐按以下顺序调用 skill：

| 阶段 | skill | 产出 |
|---|---|---|
| 从 SPEC 写实施 plan | `superpowers/writing-plans` | `docs/plan/v2/*.md` |
| 拆可并行任务 | `planning-and-task-breakdown` | 任务依赖图 |
| 执行（带 checkpoint） | `superpowers/executing-plans` | 按模块推进 |
| 每模块先写测试 | `superpowers/test-driven-development` | 03-modules 里的验收用例直接变单元测试 |
| 小步实施 | `incremental-implementation` | 每次 ≤150 行变更 |
| 声称"完成"前 | `superpowers/verification-before-completion` | 跑测试 + 查 diff |
| 合并前 | `code-review-and-quality` + `superpowers/requesting-code-review` | 独立审查 |

**每个 plan 任务 MUST 在描述里引用 SPEC 对应模块的 `Legacy Reference`**，并把任务的"实施步骤"第一条固定为：

> "读 `<legacy 路径>` 理解原实现意图，对照 SPEC 的 `Key divergence from legacy`，确认要保留的行为和要抛弃的行为，再按 TDD 开始实现。"

这不是可选动作——plan 里看不到 legacy 引用的任务，视为 plan 未完成，`writing-plans` 阶段必须补齐。如果某模块的 Legacy Reference 是 `none — greenfield`，实施步骤第一条改为"greenfield 模块，跳过 legacy 研读，直接按 SPEC 开始 TDD"，但字段本身必须在 plan 里出现。

### 4.3 代码落点：整体重写 + legacy 作为实现参考（默认路径）

**默认策略：整体重写。legacy 是参考，不是被迁移或原地修改的源。**

理由：现有代码基于未定案的 Skill/Plugin 混合设计写成，架构层面已经错位，原地迁移的成本通常高于重写。SPEC 验证（§4.1）通过后，进入本步骤：

1. **归档现有代码**。把 `src/`（及同级实现目录，如 `lib/`、`services/`）整体 `git mv` 到 `legacy/src-v1/`：
   - 提交消息固定为 `chore: archive legacy implementation to legacy/src-v1/ before rewrite`
   - 测试目录 `tests/` 分两种处理：若测试断言的行为与新 SPEC 一致，留下逐个迁移；若断言的是已被取代的旧行为，一并搬到 `legacy/tests-v1/`
   - 这一步执行前向用户确认，消息模板：
     > "现有实现 `src/` 将整体搬到 `legacy/src-v1/`，后续作为阅读参考。新实现在空的 `src/` 下按 SPEC 重写。执行？(y/n)"
2. **新建空的 `src/`**，按 `docs/spec/03-modules.md` 的 MVP 模块顺序开始。
3. **每个新模块实现前**：
   - 打开 SPEC 里该模块的 `Legacy Reference` 字段
   - 读 `legacy/src-v1/` 对应文件，理解原意图、边界处理、踩过的坑
   - 对照 `Key divergence from legacy`，明确"保留什么行为 / 抛弃什么行为"
   - 然后按 TDD 写新实现
4. **禁止动作**（违反任一即视为策略偏离，需要 ADR 解释）：
   - 直接 `cp` legacy 文件到 `src/` 改几行
   - 在 `src/` 里 `import` 任何 `legacy/` 下的模块
   - 修改 `legacy/` 里的任何文件（legacy 是只读历史）

**唯一例外**：纯工具函数 / 纯数据结构 / 第三方适配 shim——如果 SPEC 验证阶段确认这类模块与新 SPEC 完全兼容，可以原文复制到 `src/` 并在文件头注释标明 `// Copied verbatim from legacy/src-v1/<path>, see ADR-00X`。此类复制必须有对应 ADR 记录。

### 4.4 避免未来再出现"思考 vs 规格"混淆的长期机制

在仓库里建立以下物理隔离（一次性建好，之后自动维持）：

```
docs/
  design/   STATUS: DRAFT        允许矛盾的思考笔记
  spec/     STATUS: AUTHORITATIVE 工程规格，不允许矛盾
  adr/      STATUS: APPEND-ONLY   决策记录，只追加
```

约定：**代码只能引用 `spec/`**。如果代码注释里出现"按 design/ 某文档的做法"——这个决策还没升格成规格，必须先进 `spec/`。

相关 skill（已在环境中可用）：

- `spec-driven-development` — 新功能先写 spec 再写代码
- `documentation-and-adrs` — 每次架构决定记一条 ADR
- `verification-before-completion` — 声称完成前必须跑验证

### 4.5 给用户的交付话术（SPEC 完成时用）

完成 §3 后，用以下模板向用户交付，不要另行发挥。**交付话术走默认推进路径，不让用户做 A/B/C 选择题**——用户大概率不知道怎么选，AI 按默认顺序主动执行，每一步遇到需要拍板的地方再停下来问。

```text
SPEC 已生成完毕：
- docs/spec/ 下 6 份规格文档(每个 MVP 模块已标注 Legacy Reference)
- HISTORY.md 记录了旧文档中被取代的章节
- 现有代码一字未改(legacy/ 里的文档是第 0.5 步归档的结果,非本次 SPEC 生成修改)

验收清单 [X/9 项完成]:<逐条列出>

接下来按默认路径推进,我会主动执行每一步,遇到需要你拍板的地方才停下来:

  第 1 步 · SPEC 可执行性验证(§4.1,约 10 分钟,我独立做)
  第 2 步 · 毕业长期原则到 .augment/rules/(§5,需要你点头 y)
  第 3 步 · 归档现有代码到 legacy/src-v1/(§4.3 第 1 小步,需要你点头 y)
  第 4 步 · 按 SPEC 在空的 src/ 下用 TDD 重写 MVP 模块,
           每个模块先读 legacy 对应文件作为参考(§4.2 + §4.3)

我现在开始第 1 步。如果你想先自己读一遍 docs/spec/ 再继续,
回复"暂停"。
```

---

## §5 · 长期化：把本文档的原则"毕业"成项目 rules

BOOTSTRAP.md 本身是**一次性引导文档**（用一次，把思考笔记升格成 SPEC）。§4.4 里定义的那几条"长期约束"应该在 SPEC 交付后**毕业成项目 rules**，让之后每次会话都自动生效。

**触发时机**：§3 验收清单全部打勾、`docs/spec/` 已生成、用户确认进入 §4 的"下一步"之前。

**动作**：主动向用户提议：

```
SPEC 已经稳定。建议把以下长期原则固化成项目 rules
（Augment Code 每次会话会自动加载），这样后续开发不会再
把思考和规格混在一起：

  目标路径：.augment/rules/project.md
  内容来源：BOOTSTRAP §4.4 + §3 准则 7

需要我现在帮你写入吗？（y/n）
```

用户同意后，创建 `.augment/rules/project.md`，内容参考以下模板（可按项目实际情况调整，但不要删除核心条款）：

```markdown
# Project Rules

## Documentation layers (physical separation)
- `docs/design/`  — Thinking notes. Contradictions ALLOWED. STATUS: DRAFT.
- `docs/spec/`    — Engineering specs. AUTHORITATIVE. No contradictions.
- `docs/adr/`     — Architecture decision records. APPEND-ONLY.

## Rules of engagement
- Code MUST only reference `docs/spec/`, never `docs/design/` or `legacy/`.
- New features MUST land a spec in `docs/spec/` before implementation.
- Architectural decisions MUST be recorded as an ADR in `docs/adr/`.
- Before claiming "done", verification commands MUST be run and output confirmed.
- Do NOT modify files in `docs/design/` — they are historical record.

## Legacy policy (reference-only, not a source to migrate)
- `legacy/` is reference-only. Files in `legacy/` MUST NOT be edited.
- Code in `src/` MUST NOT `import`, `require`, or link to anything in `legacy/`.
- Copying verbatim from `legacy/` into `src/` is allowed ONLY for pure utilities / pure data structures / third-party adapter shims, AND requires an ADR documenting the decision and the source path.
- Before implementing any module in `src/`, the engineer MUST open the `Legacy Reference` field in `docs/spec/03-modules.md` for that module and read the files it points to in `legacy/`, to understand original intent and edge cases.
- For modules marked `none — greenfield` in `Legacy Reference`, the legacy-read step is skipped but the field itself MUST still appear in the spec.

## Workflow skills to prefer (if available)
- `spec-driven-development` for new features
- `test-driven-development` for implementation
- `verification-before-completion` before any "done" claim
- `documentation-and-adrs` for architectural decisions
```

**毕业完成后**：

- BOOTSTRAP.md 的使命结束，移到 `docs/archive/BOOTSTRAP.md` 归档（不要删，保留方便追溯）
- `.augment/rules/project.md` 接管日常约束
- ADR 第 1 条记录"从 BOOTSTRAP 毕业到 rules"的决定，引用当时的 SPEC 版本

---

_入口：先做 §3 第 0 步环境预检 → 第 0.5 步遗留资产归档（用户确认后执行 `git mv`）→ 第 1 步调研产出 `docs/spec-survey.md` 交给用户确认 → 第 2 步决策对话 → 第 3 步生成规格。SPEC 交付后按 §4 推进（默认整体重写，legacy 作参考），结束前按 §5 毕业到 rules。不要跳过调研或遗留资产归档，也不要自作主张跳过 §4 的 skill 链路直接开写代码。_

