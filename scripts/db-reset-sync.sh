#!/usr/bin/env bash
set -euo pipefail

# db-reset-sync.sh — Full reset-mode database sync
#
# Usage: scripts/db-reset-sync.sh <DB_URL>

DB_URL="${1:?Usage: $0 <DB_URL>}"

RESET_PUBLIC_SQL=$(cat <<'EOSQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
-- Schema-level privileges (matches Supabase defaults)
GRANT USAGE  ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT CREATE ON SCHEMA public TO postgres, service_role;
GRANT ALL    ON SCHEMA public TO postgres, service_role;
-- Existing objects: ALL to every API role
GRANT ALL ON ALL TABLES    IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
-- Future objects: ALL to every API role
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES    TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
EOSQL
)

echo "=== Step 1: Truncate migration history ==="
psql "$DB_URL" -c "TRUNCATE supabase_migrations.schema_migrations;"
REMAINING=$(psql "$DB_URL" -t -A -c "SELECT count(*) FROM supabase_migrations.schema_migrations;")
if [ "$REMAINING" -ne 0 ]; then
  echo "::error::Migration history not empty after truncate ($REMAINING rows remain)"
  exit 1
fi
echo "Verified: schema_migrations is empty."

echo ""
echo "=== Step 2: Reset public schema ==="
psql "$DB_URL" <<< "$RESET_PUBLIC_SQL"
echo "Public schema reset with grants applied."

echo ""
echo "=== Step 3: Push all migrations ==="
supabase db push --db-url "$DB_URL" --include-all

echo ""
echo "=== Step 4: Verify migration count ==="
EXPECTED=$(ls supabase/migrations/*.sql | wc -l)
APPLIED=$(psql "$DB_URL" -t -A -c "SELECT count(*) FROM supabase_migrations.schema_migrations;")
echo "Applied: $APPLIED / Expected: $EXPECTED"
if [ "$APPLIED" -ne "$EXPECTED" ]; then
  echo "::error::Expected $EXPECTED migrations, got $APPLIED"
  exit 1
fi

echo ""
echo "=== Step 5: Verify schema diff ==="
bash "$(dirname "${BASH_SOURCE[0]}")/check-schema-drift.sh" --db-url "$DB_URL"

echo ""
echo "=== Step 6: Verify critical objects ==="
psql "$DB_URL" -t -A -F'|' <<'SQL'
SELECT 'custom_access_token_hook' AS object,
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='custom_access_token_hook') AS present,
       EXISTS(SELECT 1 FROM information_schema.routine_privileges
              WHERE routine_name='custom_access_token_hook'
                AND grantee='supabase_auth_admin'
                AND privilege_type='EXECUTE') AS granted
UNION ALL
SELECT 'requesting_tenant_id',
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='requesting_tenant_id'), NULL
UNION ALL
SELECT 'is_tenant_admin',
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='is_tenant_admin'), NULL
UNION ALL
SELECT 'insert_effective_record',
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='insert_effective_record'), NULL
UNION ALL
SELECT 'effective_record_at',
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='effective_record_at'), NULL
UNION ALL
SELECT 'anonymize_user',
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='anonymize_user'), NULL
UNION ALL
SELECT 'export_user_data',
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='export_user_data'), NULL
UNION ALL
SELECT 'check_rate_limit',
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='check_rate_limit'), NULL
UNION ALL
SELECT 'write_audit_log',
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='write_audit_log'), NULL
UNION ALL
SELECT 'get_direct_reports',
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='get_direct_reports'), NULL
UNION ALL
SELECT 'set_manager_assessment',
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='set_manager_assessment'), NULL
UNION ALL
SELECT 'upsert_self_assessment',
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='upsert_self_assessment'), NULL
UNION ALL
SELECT 'current_app_user_id',
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='current_app_user_id'), NULL
UNION ALL
SELECT 'has_app_role',
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='has_app_role'), NULL
UNION ALL
SELECT 'compute_arco_due_date',
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
              WHERE n.nspname='public' AND p.proname='compute_arco_due_date'), NULL
UNION ALL
SELECT 'btree_gist_extension',
       EXISTS(SELECT 1 FROM pg_extension WHERE extname='btree_gist'), NULL;
SQL

echo ""
echo "=== SECURITY DEFINER functions ==="
psql "$DB_URL" -t -A <<'SQL'
SELECT p.proname || ' — SECURITY DEFINER: ' || p.prosecdef
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'custom_access_token_hook','is_tenant_admin',
    'insert_effective_record','effective_record_at',
    'anonymize_user','export_user_data',
    'check_rate_limit','purge_expired_rate_limits',
    'write_audit_log','set_manager_assessment',
    'upsert_self_assessment','get_direct_reports'
  )
ORDER BY p.proname;
SQL

MISSING=$(psql "$DB_URL" -t -A <<'SQL'
SELECT string_agg(fn, ', ')
FROM unnest(ARRAY[
  'custom_access_token_hook','requesting_tenant_id','is_tenant_admin',
  'insert_effective_record','effective_record_at','anonymize_user',
  'export_user_data','check_rate_limit','write_audit_log',
  'get_direct_reports','set_manager_assessment','upsert_self_assessment',
  'current_app_user_id','has_app_role','compute_arco_due_date'
]) AS fn
WHERE NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
  WHERE n.nspname='public' AND p.proname=fn
);
SQL
)
if [ -n "$MISSING" ] && [ "$MISSING" != "" ]; then
  echo "::error::Missing functions: $MISSING"
  exit 1
fi

echo ""
echo "Reset sync complete — all $EXPECTED migrations applied, no drift, all critical objects present."
