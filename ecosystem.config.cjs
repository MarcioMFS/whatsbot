const fs = require('fs')

// Parse the project .env into a plain object so pm2 injects the same env the
// bare `pnpm dev` process had (the backend code reads process.env directly).
function parseEnv(file) {
  const env = {}
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!m) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      env[m[1]] = v
    }
  } catch { /* missing .env → rely on ambient env */ }
  return env
}

module.exports = {
  apps: [
    {
      name: 'whatsbot-backend',
      cwd: '/root/work/whatsbot/packages/backend',
      // Single node process via tsx loader (no `watch` — deploy = `pm2 restart whatsbot-backend`).
      script: 'src/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 2000,
      max_memory_restart: '600M',
      kill_timeout: 5000,
      env: parseEnv('/root/work/whatsbot/.env'),
      out_file: '/root/work/whatsbot/pm2-backend.log',
      error_file: '/root/work/whatsbot/pm2-backend.log',
      merge_logs: true,
      time: true,
    },
  ],
}
