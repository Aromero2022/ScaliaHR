#!/usr/bin/env bash
# Full logical backup of the LOCAL Supabase database (D23). Writes a directory
# <backup-root>/full-<UTC time>/ with:
#   app.dump       schemas public, pgboss and ops: structure, data and grants
#   platform.dump  data of the accounts (auth.users, identities, MFA factors,
#                  recovery codes, passkeys) and of the migration history
#   manifest.json  schema version, time and SHA-256 of both dumps
# Sessions and one-time tokens are left out: after a restore everybody signs in
# again. pg_dump runs inside the database container, so its version always
# matches the server.
#
# Usage: scripts/backup-full.sh [backup-root]   (default: .backups, git-ignored)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=scripts/lib/local-db-container.sh
source scripts/lib/local-db-container.sh

ROOT="${1:-.backups}"
DB="$(local_db_container)"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT="${ROOT}/full-${STAMP}"

umask 077
mkdir -p "$OUT"

docker exec "$DB" pg_dump -U supabase_admin -d postgres -Fc \
  -n public -n pgboss -n ops > "$OUT/app.dump"
docker exec "$DB" pg_dump -U supabase_admin -d postgres -Fc --data-only \
  -t auth.users -t auth.identities -t auth.mfa_factors -t auth.mfa_recovery_code_sets \
  -t auth.webauthn_credentials -t supabase_migrations.schema_migrations > "$OUT/platform.dump"

SCHEMA_VERSION="$(docker exec "$DB" psql -U supabase_admin -d postgres -X -At \
  -c "SELECT max(version) FROM supabase_migrations.schema_migrations")"

cat > "$OUT/manifest.json" <<EOF
{
  "format": "scaliahr.full-backup",
  "version": 1,
  "schemaVersion": "${SCHEMA_VERSION}",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "files": {
    "app.dump": "$(sha256_of "$OUT/app.dump")",
    "platform.dump": "$(sha256_of "$OUT/platform.dump")"
  }
}
EOF

echo "Full backup written to ${OUT} (schema ${SCHEMA_VERSION})."
