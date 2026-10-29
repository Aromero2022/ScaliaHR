#!/usr/bin/env bash
# Links an existing auth.users account to the demo tenant as 'owner':
# public.users row, membership, active tenant and the owner's current
# Employee Central records (ec_personal_information, ec_job_information).
# Idempotent: running it again changes nothing.
# Usage: scripts/link-owner.sh <DB_URL> <OWNER_EMAIL>
set -euo pipefail

DB_URL="${1:?Usage: $0 <DB_URL> <OWNER_EMAIL>}"
OWNER_EMAIL="${2:?Usage: $0 <DB_URL> <OWNER_EMAIL>}"
TENANT_ID="${DEMO_TENANT_ID:-a0000000-0000-0000-0000-000000000001}"

bash "$(dirname "${BASH_SOURCE[0]}")/require-demo-tenant.sh" "$DB_URL"

echo "Looking up auth.users for: $OWNER_EMAIL"
OWNER_ID="$(psql "$DB_URL" -t -A -v ON_ERROR_STOP=1 -v email="$OWNER_EMAIL" <<'SQL'
SELECT id FROM auth.users WHERE lower(email) = lower(:'email') LIMIT 1;
SQL
)"
if [ -z "$OWNER_ID" ]; then
  echo "::warning::No auth.users record found for $OWNER_EMAIL. Skipping owner link."
  exit 0
fi
echo "Found auth user: $OWNER_ID"

psql "$DB_URL" -v ON_ERROR_STOP=1 -1 \
  -v owner_id="$OWNER_ID" -v tenant="$TENANT_ID" -v email="$OWNER_EMAIL" <<'SQL'
-- An unclaimed employee of the tenant with the same email becomes the owner.
UPDATE public.users SET auth_uid = :'owner_id'::uuid, status = 'ACTIVE', updated_at = now()
WHERE tenant_id = :'tenant'::uuid AND lower(email) = lower(:'email') AND auth_uid IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.users WHERE auth_uid = :'owner_id'::uuid);

INSERT INTO public.users (auth_uid, tenant_id, email, first_name, last_name, status, hire_date)
SELECT au.id, :'tenant'::uuid, :'email',
       coalesce(nullif(au.raw_user_meta_data->>'first_name', ''), 'Owner'),
       coalesce(nullif(au.raw_user_meta_data->>'last_name', ''), 'Account'),
       'ACTIVE', now()
FROM auth.users au WHERE au.id = :'owner_id'::uuid
ON CONFLICT (auth_uid) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  status    = 'ACTIVE';

INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role, is_active)
VALUES (:'owner_id'::uuid, :'tenant'::uuid, 'owner', true)
ON CONFLICT (user_id, tenant_id) DO UPDATE SET
  app_role  = 'owner',
  is_active = true;

INSERT INTO public.user_settings (user_id, active_tenant_id)
VALUES (:'owner_id'::uuid, :'tenant'::uuid)
ON CONFLICT (user_id) DO UPDATE SET
  active_tenant_id = EXCLUDED.active_tenant_id;

-- Current EC records, only when the owner has none yet.
INSERT INTO public.ec_personal_information (tenant_id, user_id, start_date, first_name, last_name, event_reason)
SELECT u.tenant_id, u.id, current_date, u.first_name, u.last_name, 'Hire'
FROM public.users u
WHERE u.auth_uid = :'owner_id'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM public.ec_personal_information pi
    WHERE pi.user_id = u.id AND pi.tenant_id = u.tenant_id AND pi.end_date IS NULL
  );

INSERT INTO public.ec_job_information (tenant_id, user_id, start_date, job_title, event_reason)
SELECT u.tenant_id, u.id, current_date, 'Owner', 'Hire'
FROM public.users u
WHERE u.auth_uid = :'owner_id'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM public.ec_job_information ji
    WHERE ji.user_id = u.id AND ji.tenant_id = u.tenant_id AND ji.end_date IS NULL
  );
SQL

echo "Owner linked: $OWNER_EMAIL → tenant $TENANT_ID as 'owner' (with EC records)"
