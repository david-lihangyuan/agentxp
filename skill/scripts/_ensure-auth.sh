#!/usr/bin/env bash
# _ensure-auth.sh — 确保有有效的 API key
# 被其他脚本 source，提供 $SERVER_URL 和 $API_KEY
# 如果 config.json 中 api_key 为空，自动注册并写回
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config.json"

# 读取配置
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "❌ 找不到配置文件: $CONFIG_FILE"
  echo "请先创建 config.json（至少设置 server_url）"
  exit 1
fi

SERVER_URL=$(jq -r '.server_url // "http://localhost:3141"' "$CONFIG_FILE")
API_KEY=$(jq -r '.api_key // ""' "$CONFIG_FILE")

# 如果有 key，直接返回
if [[ -n "$API_KEY" ]]; then
  return 0 2>/dev/null || true
fi

# === 自动注册 ===
echo "🔑 首次使用，正在自动注册..."

# 生成 agent_id：hostname + 随机后缀
AGENT_ID="agent-$(hostname -s 2>/dev/null || echo 'unknown')-$(head -c 4 /dev/urandom | xxd -p)"
AGENT_NAME="${USER:-agent}@$(hostname -s 2>/dev/null || echo 'local')"

REGISTER_BODY=$(jq -n \
  --arg agent_id "$AGENT_ID" \
  --arg name "$AGENT_NAME" \
  '{ agent_id: $agent_id, name: $name }')

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$SERVER_URL/register" \
  -H "Content-Type: application/json" \
  -d "$REGISTER_BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_RESPONSE=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" != "201" && "$HTTP_CODE" != "200" ]]; then
  echo "❌ 注册失败 (HTTP $HTTP_CODE)"
  echo "$BODY_RESPONSE" | jq . 2>/dev/null || echo "$BODY_RESPONSE"
  echo ""
  echo "请手动在 config.json 中设置 api_key，或检查服务器是否在运行"
  exit 1
fi

# 提取 key
API_KEY=$(echo "$BODY_RESPONSE" | jq -r '.api_key // .keys[0] // empty')

if [[ -z "$API_KEY" ]]; then
  echo "❌ 注册成功但未返回 API key"
  echo "$BODY_RESPONSE" | jq .
  exit 1
fi

# 写回 config.json
TMPFILE=$(mktemp)
jq --arg key "$API_KEY" '.api_key = $key' "$CONFIG_FILE" > "$TMPFILE" && mv "$TMPFILE" "$CONFIG_FILE"

echo "✅ 注册成功！"
echo "   Agent ID: $AGENT_ID"
echo "   API Key: ${API_KEY:0:8}..."
echo "   已保存到 config.json"
echo ""
