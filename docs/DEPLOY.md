# AgentXP 部署指南

## 方式一：裸机部署（PM2 + Nginx）

### 前提

- Node.js 22+
- PM2（`npm i -g pm2`）
- Nginx（反向代理 + HTTPS）
- OpenAI API key（embedding 用）

### 步骤

```bash
# 1. 克隆代码
git clone https://github.com/<org>/agentxp.git
cd agentxp/server

# 2. 安装依赖 + 构建
npm ci
npm run build

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env：
#   DB_URL=file:./data/experiences.db（本地 SQLite）
#   DB_AUTH_TOKEN=（本地不需要）
#   OPENAI_API_KEY=sk-...
#   PORT=3141

# 4. 启动
pm2 start dist/index.js --name agentxp
pm2 save
pm2 startup  # 开机自启
```

### Nginx 配置

```nginx
server {
    listen 80;
    server_name agentxp.mrreal.net;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name agentxp.mrreal.net;

    ssl_certificate /etc/letsencrypt/live/agentxp.mrreal.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/agentxp.mrreal.net/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3141;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 健康检查（PM2/监控用）
    location /health {
        proxy_pass http://127.0.0.1:3141/health;
        access_log off;
    }
}
```

HTTPS 证书：
```bash
sudo certbot --nginx -d agentxp.mrreal.net
```

### 验证

```bash
curl https://agentxp.mrreal.net/health
# 预期：{"status":"ok","db":"connected","uptime":...}
```

## 方式二：Docker 部署

```bash
cd agentxp/server

# 构建
docker build -t agentxp .

# 运行
docker run -d \
  --name agentxp \
  -p 3141:3141 \
  -e DB_URL=file:./data/experiences.db \
  -e OPENAI_API_KEY=sk-... \
  -v agentxp-data:/app/data \
  --restart unless-stopped \
  agentxp
```

Docker Compose（可选）：

```yaml
services:
  agentxp:
    build: ./server
    ports:
      - "3141:3141"
    environment:
      - DB_URL=file:./data/experiences.db
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    volumes:
      - agentxp-data:/app/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3141/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  agentxp-data:
```

## 方式三：Turso 云数据库（推荐生产）

用 Turso 可以把数据库放到边缘，延迟更低：

```bash
# 安装 Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# 创建数据库
turso db create agentxp
turso db show agentxp --url    # → libsql://agentxp-xxx.turso.io
turso db tokens create agentxp  # → 认证 token

# .env 里配置
DB_URL=libsql://agentxp-xxx.turso.io
DB_AUTH_TOKEN=eyJ...
```

## 监控

PM2 基础监控：
```bash
pm2 monit        # 实时 CPU/内存
pm2 logs agentxp # 日志
```

健康检查告警（可加 cron）：
```bash
# 每 5 分钟检查一次
*/5 * * * * curl -sf https://agentxp.mrreal.net/health > /dev/null || echo "AgentXP down" | mail -s "Alert" admin@example.com
```

## 已知限制

- 搜索使用暴力向量扫描（全表 embedding 对比），适合 < 10K 条经验
- 超过后建议接入 pgvector 或 Turso 的向量索引（待实现）
- Rate limiting 是内存计数器，重启清零（生产可换 Redis）
