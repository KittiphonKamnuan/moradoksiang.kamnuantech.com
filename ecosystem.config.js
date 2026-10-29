// pm2 process file.
//  • local:  pm2 start ecosystem.config.js
//  • server: managed by scripts/deploy.sh, which sets MORADOK_ROOT=<app>/current (symlink)
//            and MORADOK_SHARED=<app>/shared so every release shares data, env and venv.
const fs = require('fs');
const path = require('path');

const root = process.env.MORADOK_ROOT || __dirname;
const shared = process.env.MORADOK_SHARED || root;
const dataDir = process.env.DATA_DIR || path.join(shared, 'data');
const venvPython = path.join(shared, 'venv', 'bin', 'python');
const python = process.env.MORADOK_PYTHON || (fs.existsSync(venvPython) ? venvPython : 'python3');
const port = process.env.PORT || '3000';

module.exports = {
  apps: [
    {
      name: 'moradok-web',
      cwd: root, // a symlink on the server: reload picks up the new release
      script: 'node_modules/next/dist/bin/next',
      args: `start -p ${port}`,
      env: { NODE_ENV: 'production', DATA_DIR: dataDir, PORT: port },
      max_memory_restart: '600M',
    },
    {
      name: 'moradok-worker',
      cwd: root,
      script: 'worker/transcribe.py',
      interpreter: python,
      env: { DATA_DIR: dataDir, WHISPER_MODEL: process.env.WHISPER_MODEL || 'small', PYTHONUNBUFFERED: '1' },
      restart_delay: 10000,
    },
    {
      name: 'moradok-tunnel',
      script: 'cloudflared',
      args: `tunnel --config ${path.join(shared, 'cloudflared', 'config.yml')} run`,
      interpreter: 'none',
      restart_delay: 5000,
    },
  ],
};
