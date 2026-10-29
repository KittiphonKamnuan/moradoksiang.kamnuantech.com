#!/usr/bin/env bash
# Build a release next to the running one, switch atomically, health-check, roll back on failure.
#
# usage: bash scripts/deploy.sh [source-dir]     (default: this repo)
# env:   MORADOK_APP_DIR (default ~/moradoksiang)  PORT (3000)  KEEP_RELEASES (3)
#        HEALTH_URL (http://127.0.0.1:$PORT/api/health)
set -euo pipefail

SRC="$(cd "${1:-$(dirname "$0")/..}" && pwd)"
APP_DIR="${MORADOK_APP_DIR:-$HOME/moradoksiang}"
SHARED="$APP_DIR/shared"
PORT="${PORT:-3000}"
KEEP="${KEEP_RELEASES:-3}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:$PORT/api/health}"
SHA="$(git -C "$SRC" rev-parse --short HEAD)"
RELEASE="$APP_DIR/releases/$(date +%Y%m%d-%H%M%S)-$SHA"

log() { printf '\n▸ %s\n' "$*"; }
die() { printf '\n✗ %s\n' "$*" >&2; exit 1; }

for c in git node npm pm2 ffmpeg curl tar; do command -v "$c" >/dev/null || die "missing '$c' in PATH"; done
[ -f "$SHARED/.env.local" ] || die "no $SHARED/.env.local — run scripts/server-setup.sh first"

APPS="moradok-web"
[ -x "$SHARED/venv/bin/python" ] && APPS="$APPS,moradok-worker"

export MORADOK_ROOT="$APP_DIR/current" MORADOK_SHARED="$SHARED" PORT DATA_DIR="$SHARED/data"

log "release $SHA → $RELEASE"
mkdir -p "$APP_DIR/releases" "$SHARED/data"
mkdir -p "$RELEASE"
git -C "$SRC" archive --format=tar HEAD | tar -x -C "$RELEASE" # exactly the committed tree
ln -sfn "$SHARED/.env.local" "$RELEASE/.env.local"

cd "$RELEASE"
log "npm ci"
npm ci --no-audit --no-fund
log "next build"
NEXT_TELEMETRY_DISABLED=1 npm run build
if [[ "$APPS" == *worker* ]]; then
  log "worker dependencies"
  "$SHARED/venv/bin/pip" install -q -r worker/requirements.txt
fi

switch_to() {
  ln -sfn "$1" "$APP_DIR/current.next"
  mv -Tf "$APP_DIR/current.next" "$APP_DIR/current"
  pm2 startOrReload "$APP_DIR/current/ecosystem.config.js" --only "$APPS" --update-env
}

healthy() {
  for _ in $(seq 1 30); do
    curl -fs -o /dev/null --max-time 3 "$HEALTH_URL" && return 0
    sleep 1
  done
  return 1
}

PREV="$(readlink "$APP_DIR/current" 2>/dev/null || true)"
log "switch + reload ($APPS)"
switch_to "$RELEASE"

if ! healthy; then
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    log "health check failed — rolling back to $(basename "$PREV")"
    switch_to "$PREV"
    healthy || echo "✗ previous release is not healthy either"
  fi
  pm2 logs moradok-web --lines 40 --nostream || true
  die "deploy of $SHA failed"
fi

pm2 save --force >/dev/null

log "cleanup (keep $KEEP)"
CURRENT="$(readlink "$APP_DIR/current")"
ls -1dt "$APP_DIR"/releases/* | tail -n +"$((KEEP + 1))" | while read -r old; do
  [ "$old" != "$CURRENT" ] && rm -rf "$old"
done

printf '\n✓ deployed %s (%s)\n' "$SHA" "$HEALTH_URL"
