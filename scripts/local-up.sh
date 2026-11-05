#!/usr/bin/env bash
# One command for the whole local stack (Phase 9a, D17, D24):
#   1. Supabase local via the Supabase CLI, plus any pending migration
#   2. local-only passwords for prisma_app, worker_app and email_enqueuer
#   3. web and worker containers (docker-compose.yml); the images being
#      replaced are kept as :previous
#   4. smoke checks: /api/health, one system.ping job and one email in Mailpit
#
#   bash scripts/local-up.sh              build the current checkout and start it
#   bash scripts/local-up.sh --rollback   start the :previous images again (npm run local:rollback)
# Never touches a remote project: it aborts unless the database is on this machine.
set -euo pipefail

MODE="build"
case "${1:-}" in
  "") ;;
  --rollback) MODE="rollback" ;;
  *) printf '::error::Unknown option %s (only --rollback)\n' "$1" >&2; exit 2 ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=scripts/lib/local-db-guard.sh
source scripts/lib/local-db-guard.sh

SUPABASE_CLI_VERSION="2.122.1"
ENV_FILE=".env.docker"

log() { printf '\n==> %s\n' "$*"; }
die() { printf '::error::%s\n' "$*" >&2; exit 1; }

supabase_cli() {
  if command -v supabase >/dev/null 2>&1; then
    supabase "$@"
  else
    npx --yes "supabase@${SUPABASE_CLI_VERSION}" "$@"
  fi
}

docker info >/dev/null 2>&1 || die "Docker is not running."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 (docker compose) is required."
[ -d node_modules/pg ] || die "Dependencies are missing: run npm ci first."

log "Starting Supabase local"
supabase_cli start -x realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor

status="$(supabase_cli status --output env)"
status_value() {
  printf '%s\n' "$status" | sed -n "s/^$1=//p" | head -1 | sed -e 's/^"\(.*\)"$/\1/'
}
DB_URL="$(status_value DB_URL)"
ANON_KEY="$(status_value ANON_KEY)"
MAILPIT_URL="$(status_value MAILPIT_URL)"

require_local_db_url "$DB_URL" || exit 1

# Pending migrations only, like the production mode of db-remote-sync (D22). A
# history that differs from supabase/migrations stops here; `supabase db reset`
# rebuilds the local database from scratch (its data is lost).
log "Applying pending migrations"
supabase_cli migration up --local

if [ ! -f "$ENV_FILE" ]; then
  cp .env.docker.example "$ENV_FILE"
  log "Created $ENV_FILE from .env.docker.example"
fi
# An $ENV_FILE from an earlier version lacks newer variables: add them.
while IFS= read -r line; do
  case "$line" in '' | '#'*) continue ;; esac
  if ! grep -q "^${line%%=*}=" "$ENV_FILE"; then
    printf '%s\n' "$line" >> "$ENV_FILE"
    log "Added ${line%%=*} to $ENV_FILE from .env.docker.example"
  fi
done < .env.docker.example

log "Setting local-only passwords for prisma_app, worker_app and email_enqueuer"
node --env-file="$ENV_FILE" scripts/set-local-role-passwords.mjs "$DB_URL"

DB_PORT="$(printf '%s' "$DB_URL" | sed -E 's#^.*@[^:/]+:([0-9]+)/.*$#\1#')"
DB_CONTAINER="$(docker ps --filter "publish=${DB_PORT}" --format '{{.Names}}' | head -1)"
[ -n "$DB_CONTAINER" ] || die "Could not find the Supabase database container on port ${DB_PORT}."
SUPABASE_NETWORK="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$DB_CONTAINER" | grep '^supabase_network_' | head -1)"
[ -n "$SUPABASE_NETWORK" ] || die "Could not find the Supabase Docker network of ${DB_CONTAINER}."
export SUPABASE_NETWORK
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"

MAILPIT_PORT="$(printf '%s' "$MAILPIT_URL" | sed -E 's#^.*:([0-9]+)/?$#\1#')"
MAILPIT_HOST="$(docker ps --filter "publish=${MAILPIT_PORT}" --format '{{.Names}}' | head -1)"
[ -n "$MAILPIT_HOST" ] || die "Could not find the Mailpit container of Supabase local on port ${MAILPIT_PORT}."
export MAILPIT_HOST

IMAGES="scaliahr-web scaliahr-worker"
if [ "$MODE" = "rollback" ]; then
  for image in $IMAGES; do
    docker image inspect "${image}:previous" >/dev/null 2>&1 \
      || die "There is no ${image}:previous image: nothing to roll back to (it exists after a second npm run local:up)."
  done
  for image in $IMAGES; do
    docker image inspect "${image}:local" >/dev/null 2>&1 && docker tag "${image}:local" "${image}:rolled-back"
    docker tag "${image}:previous" "${image}:local"
  done
  log "Rolling web and worker back to the previous images (network ${SUPABASE_NETWORK})"
  docker compose --env-file "$ENV_FILE" up --no-build --force-recreate --detach --wait --wait-timeout 300
else
  for image in $IMAGES; do
    if docker image inspect "${image}:local" >/dev/null 2>&1; then
      docker tag "${image}:local" "${image}:previous"
    fi
  done
  GIT_REVISION="$(git describe --always --dirty --abbrev=12 2>/dev/null || echo unknown)"
  export GIT_REVISION
  log "Building and starting web and worker ${GIT_REVISION} (network ${SUPABASE_NETWORK})"
  docker compose --env-file "$ENV_FILE" up --build --detach --wait --wait-timeout 300
fi
for image in $IMAGES; do
  printf '%s:local is revision %s\n' "$image" \
    "$(docker image inspect -f '{{or (index .Config.Labels "org.opencontainers.image.revision") "unknown"}}' "${image}:local")"
done

WEB_ADDRESS="$(docker compose --env-file "$ENV_FILE" port web 3000)"
log "Checking http://${WEB_ADDRESS}/api/health"
curl -fsS "http://${WEB_ADDRESS}/api/health"
echo

log "Checking that the worker consumes system.ping"
docker compose --env-file "$ENV_FILE" exec -T worker node dist/smoke.js

SMOKE_TO="smoke-$(date +%s)@scaliahr.localhost"
log "Checking that the worker delivers email to Mailpit (${SMOKE_TO})"
docker compose --env-file "$ENV_FILE" exec -T worker node dist/smoke.js email "$SMOKE_TO"
curl -fsS "${MAILPIT_URL}/api/v1/search?query=to:${SMOKE_TO}" | grep -q '"messages_count":1' \
  || die "The smoke email to ${SMOKE_TO} did not reach Mailpit (is the demo tenant from supabase/seed.sql present?)."
echo "[smoke] email delivered to Mailpit"

cat <<EOF

Local stack is up.
  App:      http://localhost:${WEB_ADDRESS##*:}
  Health:   http://localhost:${WEB_ADDRESS##*:}/api/health
  Studio:   http://127.0.0.1:54323
  Mailpit:  ${MAILPIT_URL}
  Tenants:  http://<slug>.localhost:${WEB_ADDRESS##*:}  (demo: http://acme-corp.localhost:${WEB_ADDRESS##*:})
Logs: docker logs -f scaliahr-web-1   |   docker logs -f scaliahr-worker-1
Stop: npm run local:down   (add -- --all to stop Supabase too)
Runbook (rollback, backups, restore): docs/RUNBOOK.md
EOF
