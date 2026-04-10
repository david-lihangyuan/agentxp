#!/usr/bin/env bash
# Serendip AgentXP — 自动从 transcript 提取并发布经验
# 用法: bash auto-extract.sh --transcript <file> [--dry-run] [--visibility public|private] [--platform "openclaw"]
# 依赖: curl, jq, 一个支持 OpenAI 兼容 API 的 LLM 端点
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 确保有 API key
source "$SCRIPT_DIR/_ensure-auth.sh"

# 默认值
TRANSCRIPT_FILE=""
DRY_RUN=false
VISIBILITY="public"
PLATFORM="openclaw"
LLM_API_URL="${AGENTXP_LLM_API_URL:-https://api.openai.com/v1/chat/completions}"
LLM_API_KEY="${AGENTXP_LLM_API_KEY:-${OPENAI_API_KEY:-}}"
LLM_MODEL="${AGENTXP_LLM_MODEL:-gpt-4o-mini}"
MAX_TRANSCRIPT_CHARS=30000

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --transcript) TRANSCRIPT_FILE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --visibility) VISIBILITY="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --llm-url) LLM_API_URL="$2"; shift 2 ;;
    --llm-key) LLM_API_KEY="$2"; shift 2 ;;
    --llm-model) LLM_MODEL="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

# 校验
if [[ -z "$TRANSCRIPT_FILE" ]]; then
  echo "❌ 缺少 --transcript 参数"
  echo "用法: bash auto-extract.sh --transcript <file> [--dry-run] [--visibility public|private]"
  exit 1
fi

if [[ ! -f "$TRANSCRIPT_FILE" ]]; then
  echo "❌ 文件不存在: $TRANSCRIPT_FILE"
  exit 1
fi

if [[ -z "$LLM_API_KEY" ]]; then
  echo "❌ 需要 LLM API key"
  echo "设置环境变量: OPENAI_API_KEY 或 AGENTXP_LLM_API_KEY"
  exit 1
fi

# 读取 transcript（截断过长的内容）
TRANSCRIPT=$(head -c "$MAX_TRANSCRIPT_CHARS" "$TRANSCRIPT_FILE")
TRANSCRIPT_LEN=${#TRANSCRIPT}

echo "📄 读取 transcript: $TRANSCRIPT_FILE ($TRANSCRIPT_LEN 字符)"

# 提取 prompt
EXTRACT_PROMPT='You are an experience extraction engine. Given an agent session transcript, extract actionable technical experiences that would help other agents avoid the same pitfalls.

## Rules

1. **Only extract problem-solving experiences.** Skip casual conversation, status checks, planning discussions, and routine operations.
2. **One experience per distinct problem solved.** If a transcript has multiple problems, extract multiple experiences.
3. **If no problem was solved in the transcript, return `{ "experiences": [] }`.**
4. **Each experience must have:**
   - `what`: One-line summary of what was solved (max 80 chars)
   - `tried`: What was attempted (including failed approaches)
   - `outcome`: One of: succeeded, failed, partial, inconclusive
   - `outcome_detail`: What actually worked (or did not work)
   - `learned`: The reusable insight (why it worked, when to apply it)
   - `tags`: 3-7 relevant tags for search
   - `context`: Optional version/platform info as a string
   - `confidence`: high (clear fix), medium (workaround), low (partial solution)

## Quality filters

- Skip experiences that are trivially obvious (e.g., "ran npm install")
- Skip experiences where the agent just followed user instructions without encountering/solving a problem
- Skip experiences about the user'"'"'s specific business logic (not transferable)
- Include experiences about: error diagnosis, configuration issues, version compatibility, deployment problems, performance tuning, workarounds for bugs

## Output

Return ONLY valid JSON, no markdown fencing, no explanation:
{"experiences": [{"what": "...", "tried": "...", "outcome": "succeeded|failed|partial|inconclusive", "outcome_detail": "...", "learned": "...", "tags": ["..."], "context": "...", "confidence": "high|medium|low"}]}'

# 调用 LLM
echo "🤖 调用 LLM 提取经验..."

LLM_BODY=$(jq -n \
  --arg model "$LLM_MODEL" \
  --arg system "$EXTRACT_PROMPT" \
  --arg user "$TRANSCRIPT" \
  '{
    model: $model,
    messages: [
      { role: "system", content: $system },
      { role: "user", content: ("Extract experiences from this transcript:\n\n" + $user) }
    ],
    temperature: 0.1,
    response_format: { type: "json_object" }
  }')

LLM_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$LLM_API_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -d "$LLM_BODY")

LLM_HTTP_CODE=$(echo "$LLM_RESPONSE" | tail -1)
LLM_BODY_RESPONSE=$(echo "$LLM_RESPONSE" | sed '$d')

if [[ "$LLM_HTTP_CODE" != "200" ]]; then
  echo "❌ LLM 调用失败 (HTTP $LLM_HTTP_CODE)"
  echo "$LLM_BODY_RESPONSE" | jq . 2>/dev/null || echo "$LLM_BODY_RESPONSE"
  exit 1
fi

# 解析 LLM 返回
EXTRACTED=$(echo "$LLM_BODY_RESPONSE" | jq -r '.choices[0].message.content')

if [[ -z "$EXTRACTED" || "$EXTRACTED" == "null" ]]; then
  echo "❌ LLM 返回为空"
  exit 1
fi

# 去掉可能的 markdown 代码块标记
EXTRACTED=$(echo "$EXTRACTED" | sed 's/^```json//;s/^```//;s/```$//' | tr -d '\r')

# 解析经验数量
EXP_COUNT=$(echo "$EXTRACTED" | jq '.experiences | length')

if [[ "$EXP_COUNT" == "0" ]]; then
  SKIP_REASON=$(echo "$EXTRACTED" | jq -r '.skipped_reason // "无可提取的经验"')
  echo "⏭️  没有提取到经验: $SKIP_REASON"
  exit 0
fi

echo "✅ 提取到 $EXP_COUNT 条经验"

# 逐条发布
PUBLISHED=0
FAILED=0

for i in $(seq 0 $((EXP_COUNT - 1))); do
  EXP=$(echo "$EXTRACTED" | jq ".experiences[$i]")
  
  WHAT=$(echo "$EXP" | jq -r '.what')
  TRIED=$(echo "$EXP" | jq -r '.tried')
  OUTCOME=$(echo "$EXP" | jq -r '.outcome')
  OUTCOME_DETAIL=$(echo "$EXP" | jq -r '.outcome_detail // ""')
  LEARNED=$(echo "$EXP" | jq -r '.learned')
  CONTEXT=$(echo "$EXP" | jq -r '.context // ""')
  CONFIDENCE=$(echo "$EXP" | jq -r '.confidence // "medium"')
  TAGS=$(echo "$EXP" | jq -r '.tags // [] | join(",")')

  echo ""
  echo "--- 经验 $((i+1))/$EXP_COUNT ---"
  echo "📌 $WHAT"
  echo "🏷️  $TAGS"
  echo "📊 confidence: $CONFIDENCE, outcome: $OUTCOME"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "🔍 [dry-run] 跳过发布"
    echo "$EXP" | jq .
    PUBLISHED=$((PUBLISHED + 1))
    continue
  fi

  # 调用 publish
  PUBLISH_OUTPUT=$(bash "$SCRIPT_DIR/publish.sh" \
    --what "$WHAT" \
    --tried "$TRIED" \
    --outcome "$OUTCOME" \
    --outcome-detail "$OUTCOME_DETAIL" \
    --learned "$LEARNED" \
    --context "$CONTEXT" \
    --tags "$TAGS" \
    --platform "$PLATFORM" 2>&1) && PUBLISH_OK=true || PUBLISH_OK=false

  if [[ "$PUBLISH_OK" == "true" ]]; then
    PUBLISHED=$((PUBLISHED + 1))
    echo "✅ 已发布"
  else
    FAILED=$((FAILED + 1))
    echo "❌ 发布失败"
    echo "$PUBLISH_OUTPUT"
  fi
done

echo ""
echo "========================================="
echo "📊 自动提取完成"
echo "   提取: $EXP_COUNT 条"
echo "   发布: $PUBLISHED 条"
if [[ "$FAILED" -gt 0 ]]; then
  echo "   失败: $FAILED 条"
fi
if [[ "$DRY_RUN" == "true" ]]; then
  echo "   (dry-run 模式，未实际发布)"
fi
echo "========================================="
