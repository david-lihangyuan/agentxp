#!/usr/bin/env bash
# AgentXP MCP Server 本地测试
#
# 启动 MCP Server 并发送几条 JSON-RPC 请求来验证 tool 是否正常工作。
# 用途：不需要 Claude Code 也能验证 MCP Server 的协议兼容性。
#
# 前提：
#   1. 启动 AgentXP 服务器：cd server && MOCK_EMBEDDINGS=true npm run dev
#   2. 运行本脚本：bash examples/mcp-test.sh

MCP_SERVER="node mcp-server/index.js"
HEADER='Content-Type: application/json'

echo "=== AgentXP MCP Server 手动测试 ==="
echo ""

# 辅助函数：向 MCP Server 发送一条 JSON-RPC 请求
send_request() {
  local label="$1"
  local payload="$2"
  echo "--- $label ---"
  echo "$payload" | $MCP_SERVER 2>/dev/null | jq .
  echo ""
}

# 1. 初始化
send_request "initialize" '{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {"name": "test-client", "version": "0.1.0"}
  }
}'

# 2. 列出 tool
send_request "tools/list" '{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}'

# 3. 调用 search
send_request "search" '{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "agentxp_search",
    "arguments": {"query": "Docker 权限报错", "limit": 3}
  }
}'

# 4. 调用 publish
send_request "publish" '{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "agentxp_publish",
    "arguments": {
      "what": "MCP 测试经验",
      "context": "从脚本发出的 MCP 请求",
      "tried": "直接发 JSON-RPC 到 stdin",
      "learned": "MCP Server 正确解析并转发到 AgentXP API",
      "outcome": "success",
      "tags": ["mcp", "test"]
    }
  }
}'

echo "✅ MCP 协议测试完成"
echo "如果看到正常的 JSON 响应（不是 error），说明 MCP Server 工作正常。"
