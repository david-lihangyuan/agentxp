#!/usr/bin/env bash
# =============================================================================
# AgentXP Smoke Test — 端到端 HTTP 验证
#
# 用法：
#   ./scripts/smoke-test.sh [BASE_URL]
#   默认 BASE_URL=http://localhost:3141
#
# 测试完整用户旅程：
#   1. 健康检查
#   2. 注册（获取 API key）
#   3. 发布经验
#   4. 搜索经验
#   5. 验证经验
#   6. 查询单条经验
#   7. Key 管理（列出 + 撤销）
#   8. 鉴权失败场景
#   9. Rate limit（可选，需要快速连续请求）
# =============================================================================

set -uo pipefail
# 注意：不用 set -e，因为 grep 无匹配返回 1 会导致误退出

BASE_URL="${1:-http://localhost:3141}"
PASSED=0
FAILED=0
AGENT_ID="smoke-test-$(date +%s)"
API_KEY=""
EXP_ID=""
EXP_ID_2=""
API_KEY_2=""

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 兼容 macOS/Linux 的响应解析
# curl -w '\n%{http_code}' 输出最后一行是状态码，其余是 body
parse_status() {
  echo "$1" | tail -1
}
parse_body() {
  echo "$1" | sed '$d'
}

assert() {
  local condition="$1"
  local msg="$2"
  if eval "$condition"; then
    echo -e "  ${GREEN}✅ ${msg}${NC}"
    ((PASSED++))
  else
    echo -e "  ${RED}❌ ${msg}${NC}"
    ((FAILED++))
  fi
}

assert_status() {
  local actual="$1"
  local expected="$2"
  local msg="$3"
  assert "[ '$actual' = '$expected' ]" "$msg (期望 $expected, 实际 $actual)"
}

echo "🧪 AgentXP Smoke Test"
echo "   目标: $BASE_URL"
echo ""

# =============================================================================
# 1. 健康检查
# =============================================================================
echo "--- 1. 健康检查 ---"

STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/")
assert_status "$STATUS" "200" "GET / 返回 200"

HEALTH=$(curl -s "$BASE_URL/health")
HEALTH_STATUS=$(echo "$HEALTH" | grep -o '"status":"ok"' || echo "")
assert '[ -n "$HEALTH_STATUS" ]' "GET /health 返回 status=ok"

DB_STATUS=$(echo "$HEALTH" | grep -o '"db":"connected"' || echo "")
assert '[ -n "$DB_STATUS" ]' "数据库已连接"

# =============================================================================
# 2. 注册
# =============================================================================
echo ""
echo "--- 2. 用户注册 ---"

REG_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\": \"$AGENT_ID\", \"name\": \"Smoke Test Agent\"}")

REG_STATUS=$(parse_status "$REG_RESPONSE")
REG_BODY=$(parse_body "$REG_RESPONSE")
assert_status "$REG_STATUS" "201" "POST /register 新用户返回 201"

API_KEY=$(echo "$REG_BODY" | grep -o '"api_key":"[^"]*"' | cut -d'"' -f4)
assert '[ -n "$API_KEY" ]' "返回了 API key"
assert '[ "${API_KEY:0:4}" = "sxp_" ]' "API key 以 sxp_ 开头"

# 等待 rate limit 窗口重置
sleep 1

# 重复注册
REG2_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\": \"$AGENT_ID\"}")

REG2_STATUS=$(parse_status "$REG2_RESPONSE")
REG2_BODY=$(parse_body "$REG2_RESPONSE")
assert_status "$REG2_STATUS" "200" "重复注册返回 200（existing）"

API_KEY_2=$(echo "$REG2_BODY" | grep -o '"api_key":"[^"]*"' | cut -d'"' -f4)
assert '[ "$API_KEY" != "$API_KEY_2" ]' "重复注册生成不同的 key"

sleep 1

# 缺少 agent_id
BAD_REG=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -d '{}')
assert_status "$BAD_REG" "400" "缺少 agent_id 返回 400"

# =============================================================================
# 3. 发布经验
# =============================================================================
echo ""
echo "--- 3. 发布经验 ---"

PUB_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/api/publish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "experience": {
      "core": {
        "what": "Hono 框架在 Node.js 上的性能测试",
        "context": "对比 Express 和 Fastify 的 HTTP 框架选择",
        "tried": "用 Hono + @hono/node-server 替代 Express",
        "outcome": "succeeded",
        "outcome_detail": "请求吞吐量提升 3 倍，代码量减少 40%",
        "learned": "Hono 的 Web Standard API 设计使得代码可以跨运行时移植"
      },
      "tags": ["hono", "nodejs", "performance", "framework"]
    }
  }')

PUB_STATUS=$(parse_status "$PUB_RESPONSE")
PUB_BODY=$(parse_body "$PUB_RESPONSE")
assert_status "$PUB_STATUS" "201" "POST /api/publish 返回 201"

EXP_ID=$(echo "$PUB_BODY" | grep -o '"experience_id":"[^"]*"' | cut -d'"' -f4)
assert '[ -n "$EXP_ID" ]' "返回了 experience_id"

sleep 1

# 发布第二条用于后续验证测试
AGENT_ID_2="smoke-verifier-$(date +%s)"
REG3_RESPONSE=$(curl -s -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\": \"$AGENT_ID_2\"}")
VERIFIER_KEY=$(echo "$REG3_RESPONSE" | grep -o '"api_key":"[^"]*"' | cut -d'"' -f4)

PUB2_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/api/publish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VERIFIER_KEY" \
  -d '{
    "experience": {
      "core": {
        "what": "libSQL 替代 better-sqlite3",
        "context": "需要同时支持本地和远程数据库",
        "tried": "从 better-sqlite3 迁移到 @libsql/client",
        "outcome": "succeeded",
        "outcome_detail": "一套代码同时跑 SQLite 文件和 Turso 云",
        "learned": "libSQL 的 API 是异步的，迁移时注意 await"
      },
      "tags": ["libsql", "database", "migration"]
    }
  }')

PUB2_STATUS=$(parse_status "$PUB2_RESPONSE")
PUB2_BODY=$(parse_body "$PUB2_RESPONSE")
assert_status "$PUB2_STATUS" "201" "第二条经验发布成功"

EXP_ID_2=$(echo "$PUB2_BODY" | grep -o '"experience_id":"[^"]*"' | cut -d'"' -f4)

# 缺少必填字段
BAD_PUB=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/publish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"experience": {"core": {"what": "只有 what"}}}')
assert_status "$BAD_PUB" "400" "缺少必填字段返回 400"

# tried 太短（低于 20 字符质量门槛）
SHORT_TRIED=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/publish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "experience": {
      "core": {
        "what": "质量门槛测试",
        "tried": "太短了",
        "outcome": "failed",
        "learned": "这是一条足够长的 learned 字段用来测试质量门槛"
      },
      "tags": ["test"]
    }
  }')
assert_status "$SHORT_TRIED" "400" "tried 太短返回 400（质量门槛）"

# learned 太短（低于 20 字符质量门槛）
SHORT_LEARNED=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/publish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "experience": {
      "core": {
        "what": "质量门槛测试",
        "tried": "这是一条足够长的 tried 字段用来测试质量门槛",
        "outcome": "failed",
        "learned": "太短了"
      },
      "tags": ["test"]
    }
  }')
assert_status "$SHORT_LEARNED" "400" "learned 太短返回 400（质量门槛）"

# =============================================================================
# 4. 搜索
# =============================================================================
echo ""
echo "--- 4. 搜索经验 ---"

SEARCH_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/api/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"query": "Node.js HTTP framework performance"}')

SEARCH_STATUS=$(parse_status "$SEARCH_RESPONSE")
SEARCH_BODY=$(parse_body "$SEARCH_RESPONSE")
assert_status "$SEARCH_STATUS" "200" "POST /api/search 返回 200"

HAS_PRECISION=$(echo "$SEARCH_BODY" | grep -o '"precision"' || echo "")
assert '[ -n "$HAS_PRECISION" ]' "搜索结果包含 precision 通道"

HAS_SERENDIPITY=$(echo "$SEARCH_BODY" | grep -o '"serendipity"' || echo "")
assert '[ -n "$HAS_SERENDIPITY" ]' "搜索结果包含 serendipity 通道"

# 带过滤器搜索
FILTER_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/api/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"query": "database migration", "tags": ["libsql"]}')

FILTER_STATUS=$(parse_status "$FILTER_RESPONSE")
assert_status "$FILTER_STATUS" "200" "带 tag 过滤的搜索返回 200"

# 缺少 query
BAD_SEARCH=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{}')
assert_status "$BAD_SEARCH" "400" "缺少 query 返回 400"

# =============================================================================
# 5. 验证经验
# =============================================================================
echo ""
echo "--- 5. 验证流程 ---"

# verifier 验证第一条经验
VER_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/api/verify" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VERIFIER_KEY" \
  -d "{
    \"experience_id\": \"$EXP_ID\",
    \"result\": \"confirmed\",
    \"notes\": \"经我验证，Hono 确实比 Express 快\"
  }")

VER_STATUS=$(parse_status "$VER_RESPONSE")
VER_BODY=$(parse_body "$VER_RESPONSE")
assert_status "$VER_STATUS" "200" "POST /api/verify 返回 200"

HAS_VER_ID=$(echo "$VER_BODY" | grep -o '"verification_id"' || echo "")
assert '[ -n "$HAS_VER_ID" ]' "返回了 verification_id"

# 不能验证自己
SELF_VER=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/verify" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{
    \"experience_id\": \"$EXP_ID\",
    \"result\": \"confirmed\"
  }")
assert_status "$SELF_VER" "403" "不能验证自己的经验返回 403"

# 验证不存在的经验
GHOST_VER=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/verify" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "experience_id": "non-existent-id",
    "result": "confirmed"
  }')
assert_status "$GHOST_VER" "404" "验证不存在的经验返回 404"

# =============================================================================
# 6. 查询单条经验
# =============================================================================
echo ""
echo "--- 6. 查询单条经验 ---"

GET_RESPONSE=$(curl -s -w '\n%{http_code}' "$BASE_URL/api/experiences/$EXP_ID" \
  -H "Authorization: Bearer $API_KEY")

GET_STATUS=$(parse_status "$GET_RESPONSE")
GET_BODY=$(parse_body "$GET_RESPONSE")
assert_status "$GET_STATUS" "200" "GET /api/experiences/:id 返回 200"

HAS_CONFIRMED=$(echo "$GET_BODY" | grep -o '"confirmed":1' || echo "")
assert '[ -n "$HAS_CONFIRMED" ]' "验证摘要显示 1 次确认"

# 查询不存在的
NOT_FOUND=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/experiences/no-such-id" \
  -H "Authorization: Bearer $API_KEY")
assert_status "$NOT_FOUND" "404" "查询不存在的经验返回 404"

# =============================================================================
# 7. Key 管理
# =============================================================================
echo ""
echo "--- 7. Key 管理 ---"

KEYS_RESPONSE=$(curl -s -w '\n%{http_code}' "$BASE_URL/api/keys" \
  -H "Authorization: Bearer $API_KEY")

KEYS_STATUS=$(parse_status "$KEYS_RESPONSE")
KEYS_BODY=$(parse_body "$KEYS_RESPONSE")
assert_status "$KEYS_STATUS" "200" "GET /api/keys 返回 200"

# 撤销第二个 key
REVOKE_RESPONSE=$(curl -s -w '\n%{http_code}' -X DELETE "$BASE_URL/api/keys/$API_KEY_2" \
  -H "Authorization: Bearer $API_KEY")

REVOKE_STATUS=$(parse_status "$REVOKE_RESPONSE")
assert_status "$REVOKE_STATUS" "200" "DELETE /api/keys/:key 撤销成功"

# 被撤销的 key 不能再用
REVOKED_TEST=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/keys" \
  -H "Authorization: Bearer $API_KEY_2")
assert_status "$REVOKED_TEST" "401" "被撤销的 key 返回 401"

# =============================================================================
# 8. 鉴权失败
# =============================================================================
echo ""
echo "--- 8. 鉴权失败 ---"

NO_AUTH=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/keys")
assert_status "$NO_AUTH" "401" "缺少 Authorization header 返回 401"

BAD_AUTH=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/keys" \
  -H "Authorization: Bearer invalid_key_12345")
assert_status "$BAD_AUTH" "401" "无效 key 返回 401"

BAD_FORMAT=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/keys" \
  -H "Authorization: Token $API_KEY")
assert_status "$BAD_FORMAT" "401" "非 Bearer 格式返回 401"

# =============================================================================
# 结果
# =============================================================================
echo ""
echo "========================================="
echo -e "🏁 AgentXP Smoke Test: ${GREEN}${PASSED} 通过${NC}, ${RED}${FAILED} 失败${NC}"
echo "========================================="

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
