// pm2 start ecosystem.config.js && pm2 save && pm2 startup
const env = { NODE_ENV: 'production', DATA_DIR: `${__dirname}/data`, PORT: '3000' };

module.exports = {
  apps: [
    {
      name: 'moradok-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      cwd: __dirname,
      env,
      max_memory_restart: '600M',
    },
    {
      name: 'moradok-worker',
      script: 'worker/transcribe.py',
      interpreter: process.env.PYTHON ?? 'python3',
      cwd: __dirname,
      env: { DATA_DIR: env.DATA_DIR, WHISPER_MODEL: 'small', PYTHONUNBUFFERED: '1' },
      restart_delay: 10000,
    },
    {
      name: 'moradok-tunnel',
      script: 'cloudflared',
      args: `tunnel --config ${__dirname}/cloudflared/config.yml run`,
      interpreter: 'none',
      restart_delay: 5000,
    },
  ],
};
