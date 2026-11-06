#!/usr/bin/env bash
# k6 load test (D36) against the LOCAL Docker stack started by `npm run local:up`.
# Seeds the load tenants (load/seed.mjs), then runs load/pages.js in the
# pinned grafana/k6 image on the host network. Extra arguments go to k6, e.g.
#   npm run load:test                       # 1,000 + 3×50 users, 4 min at full load, 20–40 s pauses
#   THINK_MIN=2 THINK_MAX=6 LOAD_VUS=150 SMALL_VUS=10 npm run load:test   # capacity of one web process
# Results: load/.out/summary.json (git-ignored).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
K6_IMAGE="grafana/k6@sha256:00fdcebafbc86cb0137d429529b1caa401a02e09025f02fc74866fa6e2b004d8" # v1.8.2

# Not supabase-test-env.sh: it resets role passwords the running containers use.
status="$(supabase status --output env)" || { echo "::error::supabase status failed — is the local stack running?"; exit 1; }
value() { printf '%s\n' "$status" | sed -n "s/^$1=//p" | head -1 | sed -e 's/^"\(.*\)"$/\1/'; }
DB_URL="$(value DB_URL)"
API_URL="$(value API_URL)"

curl -fsS -o /dev/null http://localhost:3000/api/health || { echo "::error::the web container is not up: run npm run local:up first"; exit 1; }

mkdir -p load/.out
node load/seed.mjs "$DB_URL" "$API_URL" "$(value SERVICE_ROLE_KEY)" load/.out/accounts.json

docker run --rm --network host --user "$(id -u):$(id -g)" \
  -v "$REPO_ROOT/load/pages.js:/load/pages.js:ro" -v "$REPO_ROOT/load/.out:/out" \
  -e BASE_URL=http://localhost:3000 -e SUPABASE_URL="$API_URL" -e ANON_KEY="$(value ANON_KEY)" \
  -e ACCOUNTS=/out/accounts.json \
  -e LOAD_VUS -e SMALL_VUS -e HOLD -e RAMP -e THINK_MIN -e THINK_MAX \
  "$K6_IMAGE" run --summary-export /out/summary.json "$@" /load/pages.js
