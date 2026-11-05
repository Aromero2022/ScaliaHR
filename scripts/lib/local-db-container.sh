#!/usr/bin/env bash
# Sourced by scripts/backup-full.sh and scripts/restore-full.sh (D23).
#
# local_db_container
#   Prints the name of the Supabase local database container. Fails unless the
#   database `supabase status` reports is on this machine, so these scripts can
#   never reach a remote project: they talk to the container, not to a URL.

# shellcheck source=scripts/lib/local-db-guard.sh
source "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"

local_db_container() {
  local status db_url port container
  if command -v supabase >/dev/null 2>&1; then
    status="$(supabase status --output env)"
  else
    status="$(npx --yes supabase@2.122.1 status --output env)"
  fi || {
    echo "::error::supabase status failed — is the local stack running? (supabase start)" >&2
    return 1
  }
  db_url="$(printf '%s\n' "$status" | sed -n 's/^DB_URL=//p' | head -1 | sed -e 's/^"\(.*\)"$/\1/')"
  require_local_db_url "$db_url" || return 1
  port="$(printf '%s' "$db_url" | sed -E 's#^.*@[^:/]+:([0-9]+)/.*$#\1#')"
  container="$(docker ps --filter "publish=${port}" --format '{{.Names}}' | head -1)"
  if [ -z "$container" ]; then
    echo "::error::Could not find the Supabase database container on port ${port}." >&2
    return 1
  fi
  printf '%s\n' "$container"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}
