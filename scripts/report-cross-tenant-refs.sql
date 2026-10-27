-- Read-only report: rows whose single-column foreign key points at a row of a
-- different tenant. Run before 20261027070000_composite_tenant_fks.sql on a
-- database that already has data, e.g.:
--   psql "$DB_URL" -f scripts/report-cross-tenant-refs.sql
-- It only SELECTs; nothing is modified.

DO $$
DECLARE
  fk    record;
  r     record;
  total bigint := 0;
BEGIN
  FOR fk IN
    SELECT con.conrelid::regclass::text AS child, con.confrelid::regclass::text AS parent,
           a.attname::text AS col, ra.attname::text AS refcol
    FROM pg_constraint con
    JOIN pg_namespace cn ON cn.oid = (SELECT relnamespace FROM pg_class WHERE oid = con.conrelid)
    JOIN pg_namespace pn ON pn.oid = (SELECT relnamespace FROM pg_class WHERE oid = con.confrelid)
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1
      AND cn.nspname = 'public' AND pn.nspname = 'public'
      AND EXISTS (SELECT 1 FROM pg_attribute t WHERE t.attrelid = con.conrelid AND t.attname = 'tenant_id')
      AND EXISTS (SELECT 1 FROM pg_attribute t WHERE t.attrelid = con.confrelid AND t.attname = 'tenant_id')
    ORDER BY 1, 3
  LOOP
    FOR r IN EXECUTE format(
      'SELECT c.ctid::text AS row_ctid, c.tenant_id AS child_tenant, p.tenant_id AS parent_tenant, c.%I::text AS ref
       FROM %s c JOIN %s p ON p.%I = c.%I
       WHERE p.tenant_id IS DISTINCT FROM c.tenant_id',
      fk.col, fk.child, fk.parent, fk.refcol, fk.col)
    LOOP
      total := total + 1;
      RAISE NOTICE '%.% = % (row %, tenant %) -> %.% in tenant %',
        fk.child, fk.col, r.ref, r.row_ctid, r.child_tenant, fk.parent, fk.refcol, r.parent_tenant;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Cross-tenant references: %', total;
END $$;
