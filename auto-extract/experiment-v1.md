# Phase 3.1 自动提取实验

## 目标
从真实 agent session transcript 中，用 LLM 提取有价值的经验（Experience），评估质量。

## 实验设计
- **输入**：OpenClaw agent session 的 JSONL transcript
- **提取模型**：先用当前可用模型测试
- **评估维度**：
  1. 准确性 — 提取的经验是否真实反映了 transcript 内容
  2. 噪声过滤 — 是否正确跳过了闲聊/常规操作
  3. 结构质量 — what/context/tried/outcome/learned 是否填写合理
  4. 可操作性 — 其他 agent 看到这个经验能否直接复用

## 提取 Prompt v1
见 extract-prompt-v1.txt

## 实验记录
### 实验 1 (2026-04-10)
- Transcript: Phase 1.9 环境标签验证 session (47e8b0ab)
- 结果: [待填]
