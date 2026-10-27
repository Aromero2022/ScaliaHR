-- Every foreign key between two tenant-scoped tables becomes a composite
-- (tenant_id, col) -> (tenant_id, id) key, so a row can never reference a row
-- of another tenant (group_members, role_grants, ec_job_information and all
-- other business tables). Constraint names and ON DELETE / ON UPDATE actions
-- are kept; SET NULL only clears the referencing column (tenant_id stays).
--
-- Step 1 aborts the migration, changing nothing, if existing rows already
-- reference another tenant, and lists them per constraint.

CREATE TEMP TABLE _tenant_fks AS
SELECT con.conname::text                    AS conname,
       con.conrelid::regclass::text         AS child,
       con.confrelid::regclass::text        AS parent,
       pc.relname::text                     AS parent_name,
       a.attname::text                      AS col,
       ra.attname::text                     AS refcol,
       con.confdeltype                      AS del_action,
       con.confupdtype                      AS upd_action,
       con.condeferrable                    AS is_deferrable,
       con.condeferred                      AS is_deferred
FROM pg_constraint con
JOIN pg_class cc ON cc.oid = con.conrelid
JOIN pg_namespace cn ON cn.oid = cc.relnamespace
JOIN pg_class pc ON pc.oid = con.confrelid
JOIN pg_namespace pn ON pn.oid = pc.relnamespace
JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = con.confkey[1]
WHERE con.contype = 'f'
  AND array_length(con.conkey, 1) = 1
  AND cn.nspname = 'public' AND pn.nspname = 'public'
  AND EXISTS (SELECT 1 FROM pg_attribute t WHERE t.attrelid = con.conrelid
              AND t.attname = 'tenant_id' AND NOT t.attisdropped)
  AND EXISTS (SELECT 1 FROM pg_attribute t WHERE t.attrelid = con.confrelid
              AND t.attname = 'tenant_id' AND NOT t.attisdropped);

-- ── Step 1: report cross-tenant references ─────────────────────────────
DO $$
DECLARE
  fk       record;
  v_count  bigint;
  v_report text := '';
BEGIN
  FOR fk IN SELECT * FROM _tenant_fks ORDER BY child, col LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s c JOIN %s p ON p.%I = c.%I WHERE p.tenant_id IS DISTINCT FROM c.tenant_id',
      fk.child, fk.parent, fk.refcol, fk.col)
    INTO v_count;
    IF v_count > 0 THEN
      v_report := v_report || format(E'\n  %s.%s -> %s.%s: %s row(s)',
        fk.child, fk.col, fk.parent, fk.refcol, v_count);
    END IF;
  END LOOP;

  IF v_report <> '' THEN
    RAISE EXCEPTION 'Cross-tenant references found; nothing was changed:%', v_report
      USING HINT = 'List the rows with scripts/report-cross-tenant-refs.sql and decide how to fix them before re-running.';
  END IF;
END $$;

-- ── Step 2: convert to composite keys ──────────────────────────────────
DO $$
DECLARE
  fk        record;
  v_del     text;
  v_upd     text;
  v_defer   text;
BEGIN
  FOR fk IN SELECT * FROM _tenant_fks ORDER BY child, col LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint u
      WHERE u.conrelid = fk.parent::regclass
        AND u.contype IN ('p', 'u')
        AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
             FROM unnest(u.conkey) k(attnum)
             JOIN pg_attribute att ON att.attrelid = u.conrelid AND att.attnum = k.attnum)
          = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY['tenant_id', fk.refcol]) x)
    ) THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I UNIQUE (tenant_id, %I)',
        fk.parent, left(fk.parent_name || '_tenant_id_' || fk.refcol || '_key', 63), fk.refcol);
    END IF;

    v_del := CASE fk.del_action
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN format('SET NULL (%I)', fk.col)
      WHEN 'd' THEN format('SET DEFAULT (%I)', fk.col)
      WHEN 'r' THEN 'RESTRICT'
      ELSE 'NO ACTION'
    END;
    v_upd := CASE fk.upd_action
      WHEN 'c' THEN 'CASCADE'
      WHEN 'r' THEN 'RESTRICT'
      ELSE 'NO ACTION'
    END;
    v_defer := CASE
      WHEN fk.is_deferrable AND fk.is_deferred THEN ' DEFERRABLE INITIALLY DEFERRED'
      WHEN fk.is_deferrable THEN ' DEFERRABLE'
      ELSE ''
    END;

    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.child, fk.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (tenant_id, %I) REFERENCES %s (tenant_id, %I) ON DELETE %s ON UPDATE %s%s',
      fk.child, fk.conname, fk.col, fk.parent, fk.refcol, v_del, v_upd, v_defer);
  END LOOP;
END $$;

DROP TABLE _tenant_fks;
