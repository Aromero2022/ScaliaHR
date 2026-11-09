#!/usr/bin/env bash
# e2e with Playwright and axe (D44) against the LOCAL Docker stack started by
# `npm run local:up`. Extra arguments go to `playwright test`.
#   1. creates the e2e accounts (scripts/e2e-accounts.mjs), with a new random
#      password, in a private folder outside the repository;
#   2. runs apps/web's Playwright suite; reports, the axe report and the
#      screenshots go to apps/web/e2e-artifacts;
#   3. looks for the password and the TOTP secrets in the artifacts (the HTML
#      report's embedded zip included) and runs gitleaks over them;
#   4. always deletes the accounts, their sessions and factors, and the private
#      folder. If the scan did not pass, it deletes the artifacts too, so a
#      leak can never be uploaded.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
ARTIFACTS="$REPO_ROOT/apps/web/e2e-artifacts"

SUPABASE_CLI_VERSION="2.122.1"
supabase_cli() {
  if command -v supabase >/dev/null 2>&1; then
    supabase "$@"
  else
    npx --yes "supabase@${SUPABASE_CLI_VERSION}" "$@"
  fi
}

# Not supabase-test-env.sh: it resets role passwords the running containers use.
status="$(supabase_cli status --output env)" || { echo "::error::supabase status failed — is the local stack running?"; exit 1; }
value() { printf '%s\n' "$status" | sed -n "s/^$1=//p" | head -1 | sed -e 's/^"\(.*\)"$/\1/'; }
DB_URL="$(value DB_URL)"

curl -fsS -o /dev/null http://localhost:3000/api/health || { echo "::error::the web container is not up: run npm run local:up first"; exit 1; }

E2E_PRIVATE_DIR="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/scaliahr-e2e.XXXXXX")"
EXTRACT_DIR="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/scaliahr-e2e-scan.XXXXXX")"
chmod 700 "$E2E_PRIVATE_DIR"
export E2E_PRIVATE_DIR
SCANNED=0

finish() {
  local code=$?
  node scripts/e2e-accounts.mjs cleanup "$DB_URL" || code=1
  if [ "$SCANNED" != 1 ] && [ -d "$ARTIFACTS" ]; then
    rm -rf "$ARTIFACTS"
    echo "::error::the e2e artifacts were deleted: they did not pass the secret scan"
  fi
  rm -rf "$E2E_PRIVATE_DIR" "$EXTRACT_DIR"
  exit "$code"
}
trap finish EXIT

rm -rf "$ARTIFACTS"
node scripts/e2e-accounts.mjs setup "$DB_URL" "$(value API_URL)" "$(value SERVICE_ROLE_KEY)" "$(value ANON_KEY)"

set +e
(cd apps/web && E2E_BASE_URL=http://localhost:3000 E2E_ARTIFACTS_DIR="$ARTIFACTS" npx playwright test "$@")
e2e_status=$?
set -e

node scripts/e2e-accounts.mjs scan "$ARTIFACTS" "$EXTRACT_DIR"
if [ -d "$ARTIFACTS" ]; then
  bash scripts/check-secrets.sh "$ARTIFACTS" "$EXTRACT_DIR"
  # CI uploads the artifacts only when this file exists (D44).
  printf 'Escaneo de secretos aprobado: búsqueda exacta de la contraseña y los secretos TOTP de la corrida, y gitleaks.\n' > "$ARTIFACTS/escaneo-de-secretos.txt"
fi
SCANNED=1
exit "$e2e_status"
