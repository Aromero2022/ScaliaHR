#!/usr/bin/env bash
# Stops the web and worker containers started by scripts/local-up.sh.
#   --all   also stop Supabase local (supabase stop; data volumes are kept)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE=".env.docker"
[ -f "$ENV_FILE" ] || ENV_FILE=".env.docker.example"

# down never creates or removes the external Supabase network; any name will do.
SUPABASE_NETWORK="${SUPABASE_NETWORK:-supabase_network_unused}" \
  docker compose --env-file "$ENV_FILE" down

if [ "${1:-}" = "--all" ]; then
  if command -v supabase >/dev/null 2>&1; then
    supabase stop
  else
    npx --yes supabase@2.122.1 stop
  fi
fi
