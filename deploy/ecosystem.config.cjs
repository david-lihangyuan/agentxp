// PM2 ecosystem for the new @serendip/supernode (MVP v0.1).
// Runs alongside the legacy "agentxp" app (id 17, port 3141) during
// blue/green cutover, on a distinct port (3142) and a distinct DB path.
//
// Lifecycle on VPS:
//   cd /opt/agentxp-v0.1
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save
//
// Rollback:
//   pm2 stop agentxp-v0.1
//   (nginx flip back to :3141 if already switched)
module.exports = {
  apps: [
    {
      name: 'agentxp-v0.1',
      script: 'src/packages/supernode/dist/index.js',
      cwd: '/opt/agentxp-v0.1',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      env: {
        NODE_ENV: 'production',
        PORT: '3142',
        DB_PATH: '/opt/agentxp/data-v0.1/agentxp.db',
      },
      error_file: '/root/.pm2/logs/agentxp-v0.1-error.log',
      out_file: '/root/.pm2/logs/agentxp-v0.1-out.log',
      merge_logs: true,
      time: true,
    },
  ],
}
