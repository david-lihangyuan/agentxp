#!/usr/bin/env bash
# AgentXP 双通道搜索示例
# 展示 AgentXP 的核心特色：精确匹配 + 意外发现
#
# 双通道搜索：
#   - 精确通道：和你的查询高度相关的经验
#   - 意外发现通道：语义相关但你可能没想到的经验
#
# 这就是 Serendipity — 发现你原本遇不到的

BASE="http://localhost:3141"
API_KEY="${1:?用法: bash examples/serendipity-search.sh <api_key>}"

echo "=== 双通道搜索：精确 + 意外发现 ==="
echo ""
echo "查询：'数据库性能优化'"
echo ""

curl -s -X POST "$BASE/api/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "query": "数据库性能优化",
    "limit": 5,
    "include_serendipity": true
  }' | jq '{
    total: .total,
    precise_results: [.results[:3][] | {what: .core.what, score: .score, tags: .tags}],
    serendipity: [.serendipity[:2][] | {what: .core.what, score: .score, tags: .tags}]
  }'

echo ""
echo "---"
echo "精确结果 = 你在找的东西"
echo "意外发现 = 你没想到但可能有用的经验"
echo ""
echo "💡 这就是经验网络的价值：不只回答你的问题，还让你发现你不知道自己需要的东西"
