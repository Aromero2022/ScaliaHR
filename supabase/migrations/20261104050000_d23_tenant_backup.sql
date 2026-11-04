-- D23 — Per-tenant logical export
--
-- The worker exports one tenant on the backup.tenant_export queue. worker_app
-- still has no access to any public table: it reads through the functions
-- below, executable only by it (and the owner, which the restore script uses).
-- scripts/restore-tenant.mjs puts an export back without touching any other
-- tenant.

-- ─── Queue ──────────────────────────────────────────────────────────────────
SELECT pgboss.create_queue(
  'backup.tenant_export',
  '{"policy":"standard","retryLimit":2,"retryDelay":60,"retryBackoff":true,"deadLetter":"system.dead_letter"}'::jsonb
);

-- ─── Which tables an export covers ──────────────────────────────────────────
-- The tenant row, every public table with a tenant_id column (found from the
-- catalog, so new tables are included automatically) and the child tables that
-- reach their tenant through a parent. Not exported: rate_limits (transient)
-- and user_settings (per account, not per tenant). tenant-backup.test.ts fails
-- when a public table fits none of these.
CREATE FUNCTION public.tenant_backup_tables()
RETURNS TABLE (table_name text, parent_table text, parent_column text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT b.table_name, b.parent_table, b.parent_column
  FROM (
    SELECT 0 AS rank, 'tenants'::text AS table_name, NULL::text AS parent_table, NULL::text AS parent_column
    UNION ALL
    SELECT 1, c.relname::text, NULL, NULL
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND a.attname = 'tenant_id'
      AND NOT a.attisdropped
    UNION ALL
    SELECT 2, v.table_name, v.parent_table, v.parent_column
    FROM (VALUES
      ('talent_pool_entries', 'talent_pools', 'talent_pool_id'),
      ('succession_nominees', 'succession_plans', 'succession_plan_id')
    ) AS v (table_name, parent_table, parent_column)
  ) b
  ORDER BY b.rank, b.table_name;
$$;

-- ─── Rows of one tenant in one table, as JSON text ──────────────────────────
-- Text, not jsonb, so numbers reach the export file exactly as stored.
CREATE FUNCTION public.tenant_export_rows(p_tenant_id uuid, p_table text)
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  t record;
BEGIN
  SELECT * INTO t FROM public.tenant_backup_tables() b WHERE b.table_name = p_table;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'table % is not part of a tenant export', p_table USING ERRCODE = '22023';
  END IF;

  IF p_table = 'tenants' THEN
    RETURN QUERY SELECT to_jsonb(x)::text FROM public.tenants x WHERE x.id = p_tenant_id;
  ELSIF t.parent_table IS NULL THEN
    RETURN QUERY EXECUTE format('SELECT to_jsonb(x)::text FROM public.%I x WHERE x.tenant_id = $1', p_table)
      USING p_tenant_id;
  ELSE
    RETURN QUERY EXECUTE format(
      'SELECT to_jsonb(x)::text FROM public.%I x JOIN public.%I p ON p.id = x.%I WHERE p.tenant_id = $1',
      p_table, t.parent_table, t.parent_column
    ) USING p_tenant_id;
  END IF;
END;
$$;

-- ─── Schema version an export belongs to ────────────────────────────────────
-- A restore refuses an export taken on another schema version.
CREATE FUNCTION public.backup_schema_version()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT max(version) FROM supabase_migrations.schema_migrations;
$$;

REVOKE EXECUTE ON FUNCTION public.tenant_backup_tables() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.tenant_export_rows(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.backup_schema_version() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_backup_tables() TO worker_app;
GRANT EXECUTE ON FUNCTION public.tenant_export_rows(uuid, text) TO worker_app;
GRANT EXECUTE ON FUNCTION public.backup_schema_version() TO worker_app;
