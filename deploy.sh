#!/bin/bash
# AgentXP 安全部署脚本
# 只传编译后的 JS 文件到 dist/，绝不碰 data/ 目录
set -e

SERVER=root@154.12.191.239
REMOTE_DIR=/opt/agentxp/server/dist

echo "🔨 编译..."
cd "$(dirname "$0")/server"
npx tsc

echo "📦 部署 JS 文件到 $REMOTE_DIR..."
# 只传 .js 和 .d.ts 文件，排除任何数据文件
scp dist/*.js dist/*.d.ts "$SERVER:$REMOTE_DIR/"

echo "⚠️  不会传 data/ 目录（数据库在生产服务器上）"

echo "🔄 重启 PM2..."
ssh "$SERVER" "pm2 restart agentxp"

echo "⏳ 等待启动..."
sleep 3

echo "🏥 健康检查..."
HEALTH=$(ssh "$SERVER" "curl -s http://localhost:3141/health")
echo "$HEALTH"

echo "✅ 部署完成"
