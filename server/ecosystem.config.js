// ecosystem.config.js — PM2 configuration for the whitelist API server
//
// Deploy:
//   pm2 start ecosystem.config.js --env production
//   pm2 save
//   pm2 startup   <- generates the systemd/init script

module.exports = {
  apps: [
    {
      name: 'proxy-router-api',
      script: './index.js',
      cwd: __dirname,

      // ── Environment ──────────────────────────────────────────────────────
      env: {
        NODE_ENV: 'development',
        PORT: 1135,
        AUTH_TOKEN: 'change-me-in-production',
        WHITELIST_FILE: '/etc/squid/whitelist.txt',
        LOG_FILE: './logs/api.log',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 1135,
        // Set AUTH_TOKEN in your shell before starting:
        //   export AUTH_TOKEN="$(openssl rand -hex 32)"
        AUTH_TOKEN: process.env.AUTH_TOKEN || '',
        WHITELIST_FILE: '/etc/squid/whitelist.txt',
        LOG_FILE: './logs/api.log',
      },

      // ── Process settings ─────────────────────────────────────────────────
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',

      // ── Logging ──────────────────────────────────────────────────────────
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // ── Auto-restart ─────────────────────────────────────────────────────
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};
