# Supernode — Dockerfile
# Build and run the AgentXP Relay (Supernode) server.
# Usage: docker compose up -d

FROM node:24-alpine AS deps

WORKDIR /app

# Copy protocol package (dependency)
COPY packages/protocol ./packages/protocol

# Copy supernode package
COPY supernode/package*.json ./supernode/

# Install dependencies for protocol
WORKDIR /app/packages/protocol
RUN npm install --ignore-scripts

# Install dependencies for supernode
WORKDIR /app/supernode
RUN npm install --ignore-scripts

# Production image
FROM node:24-alpine AS runner

WORKDIR /app

# Install native build tools for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy everything from deps stage
COPY --from=deps /app ./

# Copy application source
COPY supernode/src ./supernode/src
COPY supernode/migrations ./supernode/migrations
COPY supernode/tsconfig.json ./supernode/
COPY supernode/vitest.config.ts ./supernode/

# Data directory for SQLite
RUN mkdir -p /data && chown node:node /data

USER node

WORKDIR /app/supernode

ENV DATABASE_PATH=/data/supernode.db
ENV PORT=3141
ENV NODE_ENV=production

EXPOSE 3141

# Run with tsx for TypeScript support
CMD ["node", "--import", "tsx/esm", "src/index.ts"]
