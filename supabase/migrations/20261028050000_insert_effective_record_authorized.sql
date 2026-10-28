-- insert_effective_record() is SECURITY DEFINER (bypasses RLS) and:
--   * closed open records by user_id only, in any tenant;
--   * copied every key of p_data into the INSERT, tenant_id included, so a
--     caller could write effective-dated rows into any tenant;
--   * checked no permission.
-- Now: closed list of tables, identifiers through format('%I'), values cast by
-- jsonb_populate_record, tenant forced to requesting_tenant_id(), the subject
-- must belong to that tenant, and only the owner or hr_admin of the tenant may
-- call it.

CREATE OR REPLACE FUNCTION public.insert_effective_record(
  p_table   text,
  p_user_id uuid,
  p_data    jsonb,
  p_start   date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid := public.requesting_tenant_id();
  v_new_id    uuid;
  v_columns   text[];
  v_unknown   text[];
BEGIN
  IF p_table NOT IN ('ec_job_information', 'ec_compensation', 'ec_personal_information') THEN
    RAISE EXCEPTION 'Invalid table: %', p_table USING ERRCODE = '22023';
  END IF;

  IF v_tenant_id IS NULL
     OR NOT (public.has_app_role('owner') OR public.has_app_role('hr_admin'))
     OR public.current_app_user_id() IS NULL THEN
    RAISE EXCEPTION 'Not authorized: only the owner or hr_admin of the tenant'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'User not found in tenant: %', p_user_id USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(k ORDER BY k) INTO v_columns
  FROM jsonb_object_keys(coalesce(p_data, '{}'::jsonb)) k;

  SELECT array_agg(k ORDER BY k) INTO v_unknown
  FROM unnest(coalesce(v_columns, '{}')) k
  WHERE k IN ('id', 'tenant_id', 'user_id', 'start_date', 'end_date', 'sequence', 'created_at', 'updated_at')
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = format('public.%I', p_table)::regclass
         AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped
     );

  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'Columns not allowed for %: %', p_table, array_to_string(v_unknown, ', ')
      USING ERRCODE = '22023';
  END IF;

  EXECUTE format(
    'UPDATE public.%I SET end_date = $1, updated_at = now()
     WHERE tenant_id = $2 AND user_id = $3 AND end_date IS NULL',
    p_table
  ) USING p_start, v_tenant_id, p_user_id;

  EXECUTE format(
    'INSERT INTO public.%1$I (tenant_id, user_id, start_date, end_date%2$s)
     SELECT $1, $2, $3, NULL%3$s FROM jsonb_populate_record(NULL::public.%1$I, $4) r
     RETURNING id',
    p_table,
    coalesce((SELECT string_agg(format(', %I', c), '') FROM unnest(v_columns) c), ''),
    coalesce((SELECT string_agg(format(', r.%I', c), '') FROM unnest(v_columns) c), '')
  ) USING v_tenant_id, p_user_id, p_start, coalesce(p_data, '{}'::jsonb)
  INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_effective_record(text, uuid, jsonb, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_effective_record(text, uuid, jsonb, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.insert_effective_record(text, uuid, jsonb, date) TO authenticated;
