#!/usr/bin/env bash
# Serendip Experience Network — 搜索经验
# 用法: bash search.sh --query "..." [--tags "tag1,tag2"] [--outcome succeeded] [--limit 10] [--no-serendipity]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 确保有 API key（无则自动注册）
source "$SCRIPT_DIR/_ensure-auth.sh"

# 解析参数
QUERY="" TAGS="" OUTCOME="" LIMIT=10 SERENDIPITY=true

while [[ $# -gt 0 ]]; do
  case $1 in
    --query) QUERY="$2"; shift 2 ;;
    --tags) TAGS="$2"; shift 2 ;;
    --outcome) OUTCOME="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    --no-serendipity) SERENDIPITY=false; shift ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

if [[ -z "$QUERY" ]]; then
  echo "❌ 缺少 --query 参数"
  exit 1
fi

# 构建 tags JSON
TAGS_JSON="null"
if [[ -n "$TAGS" ]]; then
  TAGS_JSON=$(echo "$TAGS" | tr ',' '\n' | jq -R . | jq -s .)
fi

# 构建 filters
FILTERS="null"
if [[ -n "$OUTCOME" ]]; then
  FILTERS=$(jq -n --arg outcome "$OUTCOME" '{ outcome: $outcome }')
fi

# 构建请求
BODY=$(jq -n \
  --arg query "$QUERY" \
  --argjson tags "$TAGS_JSON" \
  --argjson filters "$FILTERS" \
  --argjson limit "$LIMIT" \
  --argjson serendipity "$SERENDIPITY" \
  '{
    action: "search",
    query: $query,
    tags: $tags,
    filters: $filters,
    channels: {
      precision: true,
      serendipity: $serendipity
    },
    limit: $limit
  }')

# 发送请求
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$SERVER_URL/api/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "$BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_RESPONSE=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "❌ 搜索失败 (HTTP $HTTP_CODE)"
  echo "$BODY_RESPONSE" | jq . 2>/dev/null || echo "$BODY_RESPONSE"
  exit 1
fi

# 格式化输出
PRECISION_COUNT=$(echo "$BODY_RESPONSE" | jq '.precision | length')
SERENDIPITY_COUNT=$(echo "$BODY_RESPONSE" | jq '.serendipity | length')
TOTAL=$(echo "$BODY_RESPONSE" | jq '.total_available')

echo "🔍 搜索: \"$QUERY\""
echo "   找到 $TOTAL 条相关经验"
echo ""

if [[ "$PRECISION_COUNT" -gt 0 ]]; then
  echo "━━━ 精确匹配 ($PRECISION_COUNT) ━━━"
  echo "$BODY_RESPONSE" | jq -r '.precision[] | "
📌 [\(.match_score)] \(.experience.core.what)
   做法: \(.experience.core.tried[:120])
   结果: \(.experience.core.outcome) — \(.experience.core.learned[:120])
   标签: \(.experience.tags | join(", "))
   验证: \(.verification_summary.confirmed)✅ \(.verification_summary.denied)❌
   ID: \(.experience_id)"'
else
  echo "（无精确匹配结果）"
fi

if [[ "$SERENDIPITY_COUNT" -gt 0 ]]; then
  echo ""
  echo "━━━ 💡 意外发现 ($SERENDIPITY_COUNT) ━━━"
  echo "$BODY_RESPONSE" | jq -r '.serendipity[] | "
🎲 [\(.match_score)] \(.experience.core.what)
   💡 \(.serendipity_reason[:150])
   做法: \(.experience.core.tried[:120])
   结果: \(.experience.core.outcome) — \(.experience.core.learned[:120])
   ID: \(.experience_id)"'
fi

# 同时输出原始 JSON 供程序化使用
echo ""
echo "--- RAW JSON ---"
echo "$BODY_RESPONSE" | jq .
