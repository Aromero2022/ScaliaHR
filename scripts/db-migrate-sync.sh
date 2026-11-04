#!/usr/bin/env bash
# Production mode of db-remote-sync (D22): applies the pending migrations and
# nothing else. It never truncates or repairs the migration history and never
# drops a schema, so a history that differs from supabase/migrations stops it.
#
# Usage: scripts/db-migrate-sync.sh <DB_URL> <TARGET>
#   TARGET production also writes the production marker, which from then on
#   blocks reset and repair-push on that database.
set -euo pipefail

DB_URL="${1:?Usage: $0 <DB_URL> <TARGET>}"
TARGET="${2:?Usage: $0 <DB_URL> <TARGET>}"

# shellcheck source=scripts/lib/db-sync-guard.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/db-sync-guard.sh"
require_db_sync_mode_allowed production "$TARGET"

MIGRATIONS_DIR="${SUPABASE_WORKDIR:-.}/supabase/migrations"

echo "=== Step 1: Pending migrations (dry run) ==="
supabase db push --dry-run --db-url "$DB_URL"

echo ""
echo "=== Step 2: Apply pending migrations ==="
# No --include-all: a migration older than the last applied one is refused
# instead of being applied out of order.
supabase db push --db-url "$DB_URL"

echo ""
echo "=== Step 3: Verify migration count ==="
EXPECTED=$(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' | wc -l)
APPLIED=$(psql "$DB_URL" -X -t -A -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM supabase_migrations.schema_migrations;")
echo "Applied: $APPLIED / Expected: $EXPECTED"
if [ "$APPLIED" -ne "$EXPECTED" ]; then
  echo "::error::Expected $EXPECTED migrations, got $APPLIED"
  exit 1
fi

if [ "$TARGET" = "production" ]; then
  echo ""
  echo "=== Step 4: Production marker ==="
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -c "INSERT INTO ops.production_marker DEFAULT VALUES ON CONFLICT (id) DO NOTHING;"
  echo "ops.production_marker present: reset and repair-push are now blocked on this database."
fi

echo ""
echo "Production-mode sync complete: $APPLIED migrations applied, history untouched."
