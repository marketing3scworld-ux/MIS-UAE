#!/usr/bin/env bash
# BME MIS — server-side deploy step, run over SSH by .github/workflows/ci-cd.yml.
#
# Layout on the server (APP_DIR, default /srv/bme-mis):
#   shared/.env          real environment (never in git) — UPLOAD_DIR must be absolute
#   releases/<sha>/      one directory per deploy; the last KEEP_RELEASES are kept
#   current -> releases/<sha>   what pm2 runs
#
# Order matters: install + migrate + preflight happen in the NEW release before the
# `current` symlink moves, so a failure there leaves the running app untouched. If the
# app doesn't answer after the restart, the symlink is pointed back and pm2 restarted.
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/bme-mis}"
RELEASE_ID="${RELEASE_ID:?RELEASE_ID is required}"
RUN_PREFLIGHT="${RUN_PREFLIGHT:-1}"
RUN_SEED="${RUN_SEED:-0}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
PORT="${PORT:-3000}"
APP_NAME="${APP_NAME:-bme-mis}"

TARBALL="/tmp/bme-mis-${RELEASE_ID}.tgz"
RELEASE="$APP_DIR/releases/$RELEASE_ID"
SHARED_ENV="$APP_DIR/shared/.env"

log() { echo "==> $*"; }
die() { echo "::error::$*" >&2; exit 1; }

[ -f "$SHARED_ENV" ] || die "$SHARED_ENV not found — create it from .env.example first (see DEPLOYMENT.md)."
upload_dir="$(grep -E '^UPLOAD_DIR=' "$SHARED_ENV" | tail -1 | cut -d= -f2- | tr -d '"'"'" || true)"
case "$upload_dir" in
  /*) ;;
  *) die "UPLOAD_DIR in $SHARED_ENV must be an absolute path (got '${upload_dir}'), otherwise each release gets its own empty uploads folder." ;;
esac
command -v pm2 >/dev/null || die "pm2 is not installed (npm i -g pm2)."

log "Unpacking release $RELEASE_ID"
rm -rf "$RELEASE"
mkdir -p "$RELEASE"
tar -xzf "$TARBALL" -C "$RELEASE"
ln -sfn "$SHARED_ENV" "$RELEASE/.env"
cd "$RELEASE"

# package-lock.json needs npm 11+; fall back to a one-off npm 11 on older Node.
npm_major="$(npm -v | cut -d. -f1)"
if [ "$npm_major" -ge 11 ]; then NPM=(npm); else NPM=(npx -y npm@11); fi

log "Installing dependencies"
"${NPM[@]}" ci --no-audit --no-fund
npx prisma generate

log "Applying database migrations"
npx prisma migrate deploy

if [ "$RUN_SEED" = "1" ]; then
  log "Seeding (fills in missing lists only)"
  npm run seed
fi

if [ "$RUN_PREFLIGHT" = "1" ]; then
  log "Preflight: checking every env variable against the real services"
  npm run preflight
fi

previous="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"

log "Switching current -> $RELEASE"
ln -sfn "$RELEASE" "$APP_DIR/current.tmp"
mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"

restart() {
  APP_DIR="$APP_DIR" PORT="$PORT" APP_NAME="$APP_NAME" \
    pm2 startOrReload "$APP_DIR/current/ecosystem.config.cjs" --update-env
  pm2 save >/dev/null
}

# "<status> <restart count>" of our pm2 process.
pm2_state() {
  pm2 jlist | node -e '
    const p = JSON.parse(require("fs").readFileSync(0, "utf8")).find((a) => a.name === process.argv[1]);
    console.log(p ? `${p.pm2_env.status} ${p.pm2_env.restart_time}` : "missing 0");
  ' "$APP_NAME"
}

# The page must answer AND our pm2 process must be the one answering: online, and not
# crash-looping (a stray process already on $PORT would otherwise pass the curl).
healthy() {
  local ok=0
  for _ in $(seq 1 45); do
    if curl -sf -o /dev/null "http://127.0.0.1:$PORT/login"; then ok=1; break; fi
    sleep 2
  done
  [ "$ok" = 1 ] || return 1
  local before after
  before="$(pm2_state)"
  sleep 10
  after="$(pm2_state)"
  [ "${after%% *}" = "online" ] && [ "$before" = "$after" ]
}

restart
if healthy; then
  log "Healthy on port $PORT"
else
  pm2 logs "$APP_NAME" --lines 50 --nostream || true
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    echo "::error::New release did not come up — rolling back to $previous"
    ln -sfn "$previous" "$APP_DIR/current.tmp"
    mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
    restart
  fi
  die "Deploy of $RELEASE_ID failed health check."
fi

log "Pruning old releases (keeping $KEEP_RELEASES)"
cd "$APP_DIR/releases"
ls -1t | tail -n +"$((KEEP_RELEASES + 1))" | while read -r old; do
  [ "$APP_DIR/releases/$old" = "$(readlink -f "$APP_DIR/current")" ] || rm -rf -- "$old"
done

rm -f "$TARBALL" "/tmp/bme-mis-deploy-${RELEASE_ID}.sh"
log "Deployed $RELEASE_ID"
