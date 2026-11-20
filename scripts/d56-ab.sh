#!/usr/bin/env bash
# D56: main's stack for the A/B comparison of the docker job (D36). Main's
# stack is built from a worktree of HEAD^1 with main's own files: its
# migrations and seed.sql (supabase start --workdir), its .env.docker.example,
# its scripts/set-local-role-passwords.mjs and its docker-compose.yml. Main's
# images get their own tags, scaliahr-web:base and scaliahr-worker:base: never
# :local or :previous, which the PR's local:up and the rollback drill use.
# From the PR only the k6 harness (load/**, scripts/load-test.sh) and the load
# settings of the step are used.
#   bash scripts/d56-ab.sh tree                  worktree of HEAD^1, the diff and load/.out/d56-tree.json
#   bash scripts/d56-ab.sh main-up build|reuse   start Supabase and main's images from the worktree
#   bash scripts/d56-ab.sh k6 main-1|main-2      one k6 pass on main's stack, its output to a file
#   bash scripts/d56-ab.sh down                  stop the running stack, delete its data, check nothing is left
# Every failure prints "::error::D56: … ("<verdict>")" and exits 1.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=scripts/lib/local-db-guard.sh
source scripts/lib/local-db-guard.sh

SUPABASE_CLI_VERSION="2.122.1"
OUT="load/.out"
# The Supabase CLI names a local stack after its folder (supabase/config.toml
# has no project_id), so main's worktree gets the checkout's folder name: the
# same containers, network and ports as the PR's, which load-test.sh finds
# from the PR's checkout.
BASE="${D56_BASE_DIR:-${RUNNER_TEMP:?RUNNER_TEMP is not set}/d56/$(basename "$REPO_ROOT")}"
COMPOSE_PROJECT="scaliahr"
NO_REFERENCE="sin referencia"

log() { printf '\n==> %s\n' "$*"; }
# die <verdict> <message>
die() { printf '::error::D56: %s ("%s")\n' "$2" "$1" >&2; exit 1; }

supabase_cli() {
  if command -v supabase >/dev/null 2>&1; then
    supabase "$@"
  else
    npx --yes "supabase@${SUPABASE_CLI_VERSION}" "$@"
  fi
}
# value_of <status env> <NAME>, as local-up.sh reads `supabase status --output env`.
value_of() { printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -1 | sed -e 's/^"\(.*\)"$/\1/'; }

base_sha() { git rev-parse --verify HEAD^1 2>/dev/null || die "$NO_REFERENCE" "HEAD^1 is not in this checkout (fetch-depth 2)"; }

check_worktree() {
  local expected actual
  expected="$(base_sha)"
  actual="$(git -C "$BASE" rev-parse HEAD 2>/dev/null)" || die "$NO_REFERENCE" "main's worktree $BASE is missing"
  [ "$actual" = "$expected" ] || die "$NO_REFERENCE" "main's worktree is at $actual, not at HEAD^1 $expected"
}

cmd_tree() {
  [ ! -e "$BASE" ] || die "$NO_REFERENCE" "$BASE already exists"
  if [ -n "${PR_HEAD:-}" ]; then
    # On a pull request HEAD is GitHub's merge commit, as the D36 scope step checks.
    [ "$(git rev-parse --verify --quiet HEAD^2 || true)" = "$PR_HEAD" ] \
      || die "$NO_REFERENCE" "HEAD is not the merge commit of this pull request"
  fi
  local sha
  sha="$(base_sha)"
  mkdir -p "$(dirname "$BASE")" "$OUT"
  git worktree add --detach "$BASE" "$sha" >/dev/null || die "$NO_REFERENCE" "cannot create main's worktree at $BASE"
  check_worktree
  # To a file first: a failing git diff stops here, so it never reads as an empty diff.
  git diff -z --name-only --no-renames HEAD^1 HEAD > "$OUT/d56-diff.bin" || die "$NO_REFERENCE" "git diff HEAD^1 HEAD failed"
  node scripts/d56-ab.mjs tree "$BASE" "$OUT/d56-diff.bin"
}

cmd_main_up() {
  local mode="${1:-}"
  case "$mode" in build | reuse) ;; *) die "$NO_REFERENCE" "main-up needs build or reuse" ;; esac
  check_worktree

  log "Starting Supabase local from main's tree ($BASE)"
  supabase_cli start --workdir "$BASE" -x "${SUPABASE_EXCLUDE:-realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor}" \
    || die "$NO_REFERENCE" "supabase start failed for main's tree"
  local status here db_url api_url anon_key mailpit_url
  status="$(supabase_cli status --workdir "$BASE" --output env)" || die "$NO_REFERENCE" "supabase status failed for main's tree"
  db_url="$(value_of "$status" DB_URL)"
  api_url="$(value_of "$status" API_URL)"
  anon_key="$(value_of "$status" ANON_KEY)"
  mailpit_url="$(value_of "$status" MAILPIT_URL)"
  require_local_db_url "$db_url" || exit 1
  # load-test.sh reads `supabase status` from the PR's checkout: it must find this same stack.
  here="$(supabase_cli status --output env)" || die "$NO_REFERENCE" "supabase status failed from the PR's checkout"
  if [ "$(value_of "$here" DB_URL)" != "$db_url" ] || [ "$(value_of "$here" API_URL)" != "$api_url" ]; then
    die "$NO_REFERENCE" "the PR's checkout does not see main's Supabase stack"
  fi

  log "Applying main's pending migrations"
  supabase_cli migration up --local --workdir "$BASE" || die "$NO_REFERENCE" "main's migrations failed"
  cp "$BASE/.env.docker.example" "$BASE/.env.docker"
  if [ ! -d "$BASE/node_modules/pg" ]; then
    log "Installing main's dependencies for its scripts"
    (cd "$BASE" && npm ci --ignore-scripts --no-audit --no-fund) || die "$NO_REFERENCE" "npm ci failed in main's tree"
  fi
  log "Setting local-only passwords with main's script"
  (cd "$BASE" && node --env-file=.env.docker scripts/set-local-role-passwords.mjs "$db_url") \
    || die "$NO_REFERENCE" "main's set-local-role-passwords.mjs failed"

  local db_port db_container mailpit_port
  db_port="$(printf '%s' "$db_url" | sed -E 's#^.*@[^:/]+:([0-9]+)/.*$#\1#')"
  db_container="$(docker ps --filter "publish=${db_port}" --format '{{.Names}}' | head -1)"
  [ -n "$db_container" ] || die "$NO_REFERENCE" "no Supabase database container on port ${db_port}"
  SUPABASE_NETWORK="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$db_container" | grep '^supabase_network_' | head -1)"
  [ -n "$SUPABASE_NETWORK" ] || die "$NO_REFERENCE" "no Supabase Docker network on ${db_container}"
  mailpit_port="$(printf '%s' "$mailpit_url" | sed -E 's#^.*:([0-9]+)/?$#\1#')"
  MAILPIT_HOST="$(docker ps --filter "publish=${mailpit_port}" --format '{{.Names}}' | head -1)"
  [ -n "$MAILPIT_HOST" ] || die "$NO_REFERENCE" "no Mailpit container on port ${mailpit_port}"
  GIT_REVISION="$(git -C "$BASE" describe --always --dirty --abbrev=12)"
  export SUPABASE_NETWORK MAILPIT_HOST GIT_REVISION NEXT_PUBLIC_SUPABASE_ANON_KEY="$anon_key"

  local -a compose=(docker compose -p "$COMPOSE_PROJECT" -f "$BASE/docker-compose.yml" -f "$REPO_ROOT/scripts/d56-main-images.compose.yml" --env-file "$BASE/.env.docker")
  # The anon key is a build argument of the web image: a reused image must have been built with this one.
  local key_hash
  key_hash="$(printf '%s' "$anon_key" | sha256sum | cut -c1-64)"
  if [ "$mode" = "build" ]; then
    log "Building and starting main's images ${GIT_REVISION} as :base"
    "${compose[@]}" up --build --detach --wait --wait-timeout 300 || die "$NO_REFERENCE" "main's images did not build or start"
    printf '%s\n' "$key_hash" > "$OUT/d56-main-anon-key.sha256"
  else
    for image in scaliahr-web:base scaliahr-worker:base; do
      docker image inspect "$image" >/dev/null 2>&1 || die "$NO_REFERENCE" "there is no ${image} to reuse"
    done
    [ "$(cat "$OUT/d56-main-anon-key.sha256" 2>/dev/null)" = "$key_hash" ] || die "$NO_REFERENCE" "main's web image was built with another anon key"
    log "Starting main's :base images again"
    "${compose[@]}" up --no-build --force-recreate --detach --wait --wait-timeout 300 || die "$NO_REFERENCE" "main's images did not start"
  fi
  for image in scaliahr-web scaliahr-worker; do
    printf '%s:base is revision %s\n' "$image" \
      "$(docker image inspect -f '{{or (index .Config.Labels "org.opencontainers.image.revision") "unknown"}}' "${image}:base")"
  done

  local web_address smoke_to
  web_address="$("${compose[@]}" port web 3000)"
  # load-test.sh and the PR's checks use http://localhost:3000.
  [ "$web_address" = "127.0.0.1:3000" ] || die "$NO_REFERENCE" "main's web answers on ${web_address}, not 127.0.0.1:3000"
  log "Checking http://${web_address}/api/health"
  curl -fsS "http://${web_address}/api/health" || die "$NO_REFERENCE" "main's /api/health failed"
  echo
  log "Checking that main's worker consumes system.ping"
  "${compose[@]}" exec -T worker node dist/smoke.js || die "$NO_REFERENCE" "main's worker did not consume system.ping"
  smoke_to="smoke-d56-$(date +%s)@scaliahr.localhost"
  log "Checking that main's worker delivers email to Mailpit (${smoke_to})"
  "${compose[@]}" exec -T worker node dist/smoke.js email "$smoke_to" || die "$NO_REFERENCE" "main's worker did not send the smoke email"
  curl -fsS "${mailpit_url}/api/v1/search?query=to:${smoke_to}" | grep -q '"messages_count":1' \
    || die "$NO_REFERENCE" "main's smoke email did not reach Mailpit"
  echo "Main's stack is up: ${GIT_REVISION}."
}

cmd_k6() {
  local pass="${1:-}" code=0
  case "$pass" in main-1 | main-2) ;; *) die "$NO_REFERENCE" "k6 runs main-1 or main-2 only" ;; esac
  rm -f "$OUT/summary-${pass}.json" "$OUT/requests-${pass}.csv.gz" "$OUT/k6-${pass}.txt"
  # The PR's harness, which re-seeds the load tenants first, with the step's load
  # settings. k6's summary goes to a file: the job's only steady-state page line
  # stays the first PR pass's (D36, D54).
  LOAD_SUMMARY="summary-${pass}.json" npm run load:test -- --out "csv=fileName=/out/requests-${pass}.csv.gz,timeFormat=unix_milli" \
    > "$OUT/k6-${pass}.txt" 2>&1 || code=$?
  node scripts/d56-ab.mjs record "$pass" "$code"
}

cmd_down() {
  log "Stopping the stack and deleting its data"
  # Any value will do for the compose file's required variables: down never uses them.
  SUPABASE_NETWORK=unused MAILPIT_HOST=unused docker compose -p "$COMPOSE_PROJECT" --env-file .env.docker.example down --remove-orphans \
    || die "$NO_REFERENCE" "docker compose down failed"
  supabase_cli stop --no-backup || die "$NO_REFERENCE" "supabase stop --no-backup failed"
  # The next stack must start from nothing: no container, volume or network of
  # either stack, and nothing answering on port 3000.
  local left
  left="$(
    docker ps -a --format '{{.Names}}' | grep -E '^(supabase_|scaliahr-)' || true
    docker volume ls --format '{{.Name}}' | grep -E '^supabase_' || true
    docker network ls --format '{{.Name}}' | grep -E '^supabase_network_' || true
  )"
  [ -z "$left" ] || die "$NO_REFERENCE" "the stack was not cleaned up: $(printf '%s' "$left" | tr '\n' ' ')"
  if curl -fsS --max-time 2 -o /dev/null http://localhost:3000/api/health 2>/dev/null; then
    die "$NO_REFERENCE" "something still answers on port 3000"
  fi
  echo "The stack is down and its data deleted."
}

case "${1:-}" in
  tree) cmd_tree ;;
  main-up) cmd_main_up "${2:-}" ;;
  k6) cmd_k6 "${2:-}" ;;
  down) cmd_down ;;
  *) die "$NO_REFERENCE" "usage: bash scripts/d56-ab.sh tree | main-up build|reuse | k6 main-1|main-2 | down" ;;
esac
