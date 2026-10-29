#!/usr/bin/env bash
# One-time setup of the home server layout used by scripts/deploy.sh
#
#   <app>/releases/<time>-<sha>/   each deploy (last 3 kept)
#   <app>/current -> releases/…    what pm2 runs
#   <app>/shared/data/             app.db + audio  (never touched by deploys)
#   <app>/shared/.env.local        runtime config
#   <app>/shared/cloudflared/config.yml
#   <app>/shared/venv/             optional: python venv for the transcription worker
#
# usage: bash scripts/server-setup.sh [--with-worker]
set -euo pipefail

APP_DIR="${MORADOK_APP_DIR:-$HOME/moradoksiang}"
SHARED="$APP_DIR/shared"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${NEXT_PUBLIC_BASE_URL:-https://moradoksiang.kamnuantech.com}"

for c in git node npm pm2 ffmpeg curl tar; do
  command -v "$c" >/dev/null || { echo "✗ missing '$c' — install it first"; exit 1; }
done

mkdir -p "$APP_DIR/releases" "$SHARED/data" "$SHARED/cloudflared"

if [ ! -f "$SHARED/.env.local" ]; then
  cat > "$SHARED/.env.local" <<ENV
NEXT_PUBLIC_BASE_URL=$BASE_URL
# DATA_DIR is set by pm2 (shared/data) — do not set it here
DEMO_BOOK_TOKEN=
TRANSCRIBE=on
ENV
  echo "✓ created $SHARED/.env.local"
fi

if [ ! -f "$SHARED/cloudflared/config.yml" ]; then
  cp "$REPO/cloudflared/config.example.yml" "$SHARED/cloudflared/config.yml"
  echo "✓ created $SHARED/cloudflared/config.yml — edit credentials-file to point at your tunnel .json"
fi

if [ "${1:-}" = "--with-worker" ] && [ ! -x "$SHARED/venv/bin/python" ]; then
  python3 -m venv "$SHARED/venv"
  "$SHARED/venv/bin/pip" install -q -r "$REPO/worker/requirements.txt"
  echo "✓ python venv with faster-whisper at $SHARED/venv"
fi

echo
echo "Next:"
echo "  1. first deploy:   bash scripts/deploy.sh"
echo "  2. start tunnel:   MORADOK_ROOT=$APP_DIR/current MORADOK_SHARED=$SHARED pm2 start $APP_DIR/current/ecosystem.config.js --only moradok-tunnel"
echo "  3. survive reboot: pm2 save && pm2 startup   (run the command it prints)"
