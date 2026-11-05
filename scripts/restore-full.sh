#!/usr/bin/env bash
# Restores a full backup from scripts/backup-full.sh into the LOCAL Supabase
# database, in place and in a single transaction: if any statement fails,
# nothing changes (D23).
#
# Usage: scripts/restore-full.sh <backup-dir>
#
# Refuses when the dumps do not match their SHA-256, when the backup's schema
# version is not the last migration of this checkout (check out the matching
# commit first), or while the web and worker containers are running
# (npm run local:down first).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=scripts/lib/local-db-container.sh
source scripts/lib/local-db-container.sh

die() { printf '::error::%s\n' "$*" >&2; exit 1; }

DIR="${1:?Usage: $0 <backup-dir>}"
[ -f "$DIR/manifest.json" ] || die "$DIR has no manifest.json"

manifest_value() {
  node -e 'const m = require(process.argv[1]); const v = process.argv[2].split(".").reduce((o, k) => o?.[k], m); if (typeof v !== "string") process.exit(1); console.log(v);' \
    "$(cd "$DIR" && pwd)/manifest.json" "$1"
}
[ "$(manifest_value format)" = "scaliahr.full-backup" ] || die "$DIR is not a ScaliaHR full backup"
for file in app.dump platform.dump; do
  expected="$(node -e 'const m = require(process.argv[1]); console.log(m.files[process.argv[2]] ?? "")' "$(cd "$DIR" && pwd)/manifest.json" "$file")"
  [ -f "$DIR/$file" ] && [ "$(sha256_of "$DIR/$file")" = "$expected" ] || die "$DIR/$file is missing or corrupted (SHA-256 mismatch)"
done

BACKUP_VERSION="$(manifest_value schemaVersion)"
CODE_VERSION="$(basename "$(ls supabase/migrations/*.sql | sort | tail -1)" | cut -d_ -f1)"
[ "$BACKUP_VERSION" = "$CODE_VERSION" ] \
  || die "The backup is at schema ${BACKUP_VERSION} but this checkout ends at ${CODE_VERSION}: check out the commit whose last migration is ${BACKUP_VERSION}."

if [ -n "$(docker ps --filter label=com.docker.compose.project=scaliahr --filter status=running -q)" ]; then
  die "The web and worker containers are running: stop them with npm run local:down, then restore."
fi

DB="$(local_db_container)"
echo "Restoring ${DIR} (schema ${BACKUP_VERSION}) into ${DB}..."
{
  echo "SET lock_timeout = '30s';"
  echo "DROP SCHEMA IF EXISTS public, pgboss, ops CASCADE;"
  # Cascades to sessions, tokens and the rest of auth; public is already gone.
  echo "TRUNCATE auth.users CASCADE;"
  echo "TRUNCATE supabase_migrations.schema_migrations;"
  # Accounts first: public's foreign keys to auth.users are recreated with app.dump.
  docker exec -i "$DB" pg_restore --data-only --disable-triggers -f - < "$DIR/platform.dump"
  docker exec -i "$DB" pg_restore -f - < "$DIR/app.dump"
  echo "NOTIFY pgrst, 'reload schema';"
} | docker exec -i "$DB" psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 --single-transaction

echo "Full restore complete. Start the stack again with npm run local:up."
