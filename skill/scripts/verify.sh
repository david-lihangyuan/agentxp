#!/usr/bin/env bash
# Serendip Experience Network — 验证经验
# 用法: bash verify.sh --id "experience-uuid" --result confirmed [--conditions "..."] [--notes "..."] [--platform "openclaw"]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 确保有 API key（无则自动注册）
source "$SCRIPT_DIR/_ensure-auth.sh"

# 解析参数
EXP_ID="" RESULT="" CONDITIONS="" NOTES="" PLATFORM="openclaw"

while [[ $# -gt 0 ]]; do
  case $1 in
    --id) EXP_ID="$2"; shift 2 ;;
    --result) RESULT="$2"; shift 2 ;;
    --conditions) CONDITIONS="$2"; shift 2 ;;
    --notes) NOTES="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

if [[ -z "$EXP_ID" || -z "$RESULT" ]]; then
  echo "❌ 缺少必填参数"
  echo "必填: --id (经验 ID), --result (confirmed|denied|conditional)"
  exit 1
fi

if [[ ! "$RESULT" =~ ^(confirmed|denied|conditional)$ ]]; then
  echo "❌ result 必须是: confirmed, denied, conditional"
  exit 1
fi

# 构建请求
BODY=$(jq -n \
  --arg id "$EXP_ID" \
  --arg result "$RESULT" \
  --arg conditions "${CONDITIONS:-}" \
  --arg notes "${NOTES:-}" \
  --arg platform "$PLATFORM" \
  '{
    action: "verify",
    experience_id: $id,
    verifier: { agent_id: "", platform: $platform },
    result: $result,
    conditions: (if $conditions == "" then null else $conditions end),
    notes: (if $notes == "" then null else $notes end)
  }')

# 发送请求
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$SERVER_URL/api/verify" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "$BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_RESPONSE=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" == "200" ]]; then
  VER_ID=$(echo "$BODY_RESPONSE" | jq -r '.verification_id')
  SUMMARY=$(echo "$BODY_RESPONSE" | jq -r '.experience_verification_summary | "\(.confirmed)✅ \(.denied)❌ \(.conditional)⚠️ (共\(.total)条)"')
  
  case "$RESULT" in
    confirmed) EMOJI="✅" ;;
    denied) EMOJI="❌" ;;
    conditional) EMOJI="⚠️" ;;
  esac
  
  echo "$EMOJI 验证已记录"
  echo "   验证 ID: $VER_ID"
  echo "   该经验验证统计: $SUMMARY"
  echo "$BODY_RESPONSE" | jq .
else
  echo "❌ 验证失败 (HTTP $HTTP_CODE)"
  echo "$BODY_RESPONSE" | jq . 2>/dev/null || echo "$BODY_RESPONSE"
  exit 1
fi
