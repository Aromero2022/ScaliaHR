#!/usr/bin/env bash
# One command for the whole local stack (Phase 9a, D17):
#   1. Supabase local via the Supabase CLI
#   2. local-only passwords for prisma_app and worker_app
#   3. web and worker containers (docker-compose.yml)
#   4. smoke checks: /api/health and one system.ping job
# Never touches a remote project: it aborts unless the database is on this machine.
set -euo pipefail

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

require_local_db_url "$DB_URL" || exit 1

if [ ! -f "$ENV_FILE" ]; then
  cp .env.docker.example "$ENV_FILE"
  log "Created $ENV_FILE from .env.docker.example"
fi

log "Setting local-only passwords for prisma_app and worker_app"
node --env-file="$ENV_FILE" scripts/set-local-role-passwords.mjs "$DB_URL"

DB_PORT="$(printf '%s' "$DB_URL" | sed -E 's#^.*@[^:/]+:([0-9]+)/.*$#\1#')"
DB_CONTAINER="$(docker ps --filter "publish=${DB_PORT}" --format '{{.Names}}' | head -1)"
[ -n "$DB_CONTAINER" ] || die "Could not find the Supabase database container on port ${DB_PORT}."
SUPABASE_NETWORK="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$DB_CONTAINER" | grep '^supabase_network_' | head -1)"
[ -n "$SUPABASE_NETWORK" ] || die "Could not find the Supabase Docker network of ${DB_CONTAINER}."
export SUPABASE_NETWORK
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"

log "Building and starting web and worker (network ${SUPABASE_NETWORK})"
docker compose --env-file "$ENV_FILE" up --build --detach --wait --wait-timeout 300

WEB_ADDRESS="$(docker compose --env-file "$ENV_FILE" port web 3000)"
log "Checking http://${WEB_ADDRESS}/api/health"
curl -fsS "http://${WEB_ADDRESS}/api/health"
echo

log "Checking that the worker consumes system.ping"
docker compose --env-file "$ENV_FILE" exec -T worker node dist/smoke.js

cat <<EOF

Local stack is up.
  App:      http://localhost:${WEB_ADDRESS##*:}
  Health:   http://localhost:${WEB_ADDRESS##*:}/api/health
  Studio:   http://127.0.0.1:54323
  Mailpit:  http://127.0.0.1:54324
Logs: docker compose logs -f web worker
Stop: npm run local:down   (add -- --all to stop Supabase too)
EOF
