#!/usr/bin/env bash
# Fails unless the demo tenant exists. Used before linking owner_email.
# Usage: scripts/require-demo-tenant.sh <DB_URL>
set -euo pipefail

DB_URL="${1:?Usage: $0 <DB_URL>}"
TENANT_ID="${DEMO_TENANT_ID:-a0000000-0000-0000-0000-000000000001}"

EXISTS="$(psql "$DB_URL" -t -A -v ON_ERROR_STOP=1 -v tenant="$TENANT_ID" <<'SQL'
SELECT EXISTS (SELECT 1 FROM public.tenants WHERE id = :'tenant'::uuid);
SQL
)"

if [ "$EXISTS" != "t" ]; then
  echo "::error::owner_email was provided but the demo tenant $TENANT_ID does not exist. Run the sync with load_seed=true so supabase/seed.sql creates it."
  exit 1
fi
echo "Demo tenant $TENANT_ID exists."
