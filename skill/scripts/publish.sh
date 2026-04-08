#!/usr/bin/env bash
# Serendip Experience Network — 发布经验
# 用法: bash publish.sh --what "..." --tried "..." --learned "..." --outcome succeeded [--context "..."] [--outcome-detail "..."] [--tags "tag1,tag2"] [--platform "openclaw"]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 确保有 API key（无则自动注册）
source "$SCRIPT_DIR/_ensure-auth.sh"

# 解析参数
WHAT="" CONTEXT="" TRIED="" OUTCOME="" OUTCOME_DETAIL="" LEARNED="" TAGS="" PLATFORM="openclaw"

while [[ $# -gt 0 ]]; do
  case $1 in
    --what) WHAT="$2"; shift 2 ;;
    --context) CONTEXT="$2"; shift 2 ;;
    --tried) TRIED="$2"; shift 2 ;;
    --outcome) OUTCOME="$2"; shift 2 ;;
    --outcome-detail) OUTCOME_DETAIL="$2"; shift 2 ;;
    --learned) LEARNED="$2"; shift 2 ;;
    --tags) TAGS="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

# 校验必填
if [[ -z "$WHAT" || -z "$TRIED" || -z "$LEARNED" || -z "$OUTCOME" ]]; then
  echo "❌ 缺少必填参数"
  echo "必填: --what, --tried, --learned, --outcome (succeeded|failed|partial|inconclusive)"
  exit 1
fi

if [[ ! "$OUTCOME" =~ ^(succeeded|failed|partial|inconclusive)$ ]]; then
  echo "❌ outcome 必须是: succeeded, failed, partial, inconclusive"
  exit 1
fi

# 构建 tags JSON 数组
TAGS_JSON="[]"
if [[ -n "$TAGS" ]]; then
  TAGS_JSON=$(echo "$TAGS" | tr ',' '\n' | jq -R . | jq -s .)
fi

# 构建请求 body
BODY=$(jq -n \
  --arg what "$WHAT" \
  --arg context "${CONTEXT:-}" \
  --arg tried "$TRIED" \
  --arg outcome "$OUTCOME" \
  --arg outcome_detail "${OUTCOME_DETAIL:-}" \
  --arg learned "$LEARNED" \
  --arg platform "$PLATFORM" \
  --argjson tags "$TAGS_JSON" \
  '{
    experience: {
      version: "serendip-experience/0.1",
      publisher: { agent_id: "", platform: $platform },
      core: {
        what: $what,
        context: $context,
        tried: $tried,
        outcome: $outcome,
        outcome_detail: $outcome_detail,
        learned: $learned
      },
      tags: $tags
    }
  }')

# 发送请求
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$SERVER_URL/api/publish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "$BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_RESPONSE=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" == "201" ]]; then
  EXP_ID=$(echo "$BODY_RESPONSE" | jq -r '.experience_id')
  echo "✅ 经验已发布"
  echo "   ID: $EXP_ID"
  echo "$BODY_RESPONSE" | jq .
else
  echo "❌ 发布失败 (HTTP $HTTP_CODE)"
  echo "$BODY_RESPONSE" | jq . 2>/dev/null || echo "$BODY_RESPONSE"
  exit 1
fi
