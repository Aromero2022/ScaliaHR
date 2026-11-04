#!/usr/bin/env bash
# Guards for database syncs (D7, D22). Source it:
#   source scripts/lib/db-sync-guard.sh
#
# Targets: local, dev, staging, production. Modes:
#   production   applies pending migrations only (scripts/db-migrate-sync.sh)
#   reset        drops public and recreates it from every migration
#   repair-push  rewrites the migration history, then pushes every migration
# Production only ever gets the production mode.

DB_SYNC_TARGETS="local dev staging production"
DB_SYNC_MODES="production reset repair-push"

_db_sync_in_list() {
  local item
  for item in $2; do
    [ "$item" = "$1" ] && return 0
  done
  return 1
}

# Exit status 0 when the mode may run against the target.
db_sync_mode_allowed() {
  local mode="$1" target="$2"
  _db_sync_in_list "$mode" "$DB_SYNC_MODES" || return 1
  _db_sync_in_list "$target" "$DB_SYNC_TARGETS" || return 1
  [ "$target" != "production" ] || [ "$mode" = "production" ]
}

require_db_sync_mode_allowed() {
  if ! db_sync_mode_allowed "$1" "$2"; then
    echo "::error::Mode '$1' is not allowed for target '$2'. Targets: $DB_SYNC_TARGETS. Production only accepts mode 'production' (pending migrations only)." >&2
    return 1
  fi
}

# Refuses a destructive sync (reset, repair-push) when the database carries
# the production marker, or when it cannot be checked: never fail open.
require_not_production_db() {
  local db_url="$1" exists marked
  if ! exists="$(psql "$db_url" -X -t -A -v ON_ERROR_STOP=1 -c "SELECT to_regclass('ops.production_marker') IS NOT NULL")"; then
    echo "::error::Could not check the production marker; refusing the destructive sync." >&2
    return 1
  fi
  if [ "$exists" = "t" ]; then
    if ! marked="$(psql "$db_url" -X -t -A -v ON_ERROR_STOP=1 -c "SELECT EXISTS (SELECT 1 FROM ops.production_marker)")"; then
      echo "::error::Could not read the production marker; refusing the destructive sync." >&2
      return 1
    fi
    if [ "$marked" = "t" ]; then
      echo "::error::This database is marked as production (ops.production_marker). Reset and repair-push are blocked; use mode 'production'." >&2
      return 1
    fi
  fi
}
