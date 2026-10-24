-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  S1 — Security Hardening (Steps 1–3)                              ║
-- ║                                                                    ║
-- ║  1. requesting_tenant_id(): JWT-only, no fallback                  ║
-- ║  2. Drop current_tenant_id()                                       ║
-- ║  3. ARCO policies: role-based (subject + admin)                    ║
-- ║  4. SECURITY DEFINER functions: SET search_path = ''               ║
-- ║     + admin-only anonymize, subject+admin export, audit logging    ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════
-- STEP 1: Unify tenant_id resolution
--   requesting_tenant_id() reads ONLY the JWT claim. No fallback.
--   Drop current_tenant_id() entirely.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.requesting_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::json ->> 'tenant_id',
    ''
  )::uuid;
$$;

REVOKE EXECUTE ON FUNCTION public.requesting_tenant_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.requesting_tenant_id() FROM anon;
GRANT  EXECUTE ON FUNCTION public.requesting_tenant_id() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.requesting_tenant_id() TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prisma_app') THEN
    GRANT EXECUTE ON FUNCTION public.requesting_tenant_id() TO prisma_app;
  END IF;
END $$;

-- Drop current_tenant_id() — all callers now use requesting_tenant_id()
DROP FUNCTION IF EXISTS public.current_tenant_id();

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2: Rewrite ARCO policies with requesting_tenant_id()
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS arco_requests_select ON arco_requests;
DROP POLICY IF EXISTS arco_requests_insert ON arco_requests;
DROP POLICY IF EXISTS arco_requests_update ON arco_requests;

CREATE POLICY arco_select ON arco_requests
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.requesting_tenant_id()
    AND (
      subject_id = (
        SELECT u.id FROM public.users u
        WHERE u.auth_uid = auth.uid()
          AND u.tenant_id = public.requesting_tenant_id()
        LIMIT 1
      )
      OR public.is_tenant_admin()
    )
  );

CREATE POLICY arco_insert ON arco_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.requesting_tenant_id()
    AND public.is_tenant_admin()
  );

CREATE POLICY arco_update ON arco_requests
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.requesting_tenant_id()
    AND public.is_tenant_admin()
  );

CREATE POLICY arco_service_bypass ON arco_requests
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prisma_app') THEN
    GRANT SELECT, INSERT, UPDATE ON arco_requests TO prisma_app;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- STEP 3: Fix SECURITY DEFINER functions — SET search_path = ''
--   All table/function references must be schema-qualified.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 3a. is_tenant_admin() ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_tenant_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.role_assignments ra
    JOIN public.permission_roles pr ON pr.id = ra.role_id
    JOIN public.permission_groups pg ON pg.id = ra.granted_group_id
    WHERE pr.is_admin_role = true
      AND pr.tenant_id = public.requesting_tenant_id()
      AND pg.tenant_id = public.requesting_tenant_id()
      AND ra.tenant_id = public.requesting_tenant_id()
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_uid = auth.uid()
          AND u.tenant_id = public.requesting_tenant_id()
      )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_tenant_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_tenant_admin() FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_tenant_admin() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_tenant_admin() TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prisma_app') THEN
    GRANT EXECUTE ON FUNCTION public.is_tenant_admin() TO prisma_app;
  END IF;
END $$;

-- ─── 3b. insert_effective_record() ────────────────────────────────
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
  v_new_id uuid;
  v_key    text;
  v_val    text;
  v_col_arr text[] := ARRAY[]::text[];
  v_val_arr text[] := ARRAY[]::text[];
  v_cols   text;
  v_vals   text;
BEGIN
  IF p_table NOT IN ('ec_job_information', 'ec_compensation', 'ec_personal_information') THEN
    RAISE EXCEPTION 'Invalid table: %', p_table;
  END IF;

  EXECUTE format(
    'UPDATE public.%I SET end_date = $1, updated_at = now() WHERE user_id = $2 AND end_date IS NULL',
    p_table
  ) USING p_start, p_user_id;

  FOR v_key, v_val IN SELECT * FROM jsonb_each_text(p_data)
  LOOP
    IF v_key NOT IN ('id', 'created_at', 'updated_at', 'end_date') THEN
      v_col_arr := v_col_arr || quote_ident(v_key);
      v_val_arr := v_val_arr || quote_literal(v_val);
    END IF;
  END LOOP;

  v_cols := array_to_string(v_col_arr, ', ');
  v_vals := array_to_string(v_val_arr, ', ');

  EXECUTE format(
    'INSERT INTO public.%I (user_id, start_date, end_date, %s) VALUES ($1, $2, NULL, %s) RETURNING id',
    p_table, v_cols, v_vals
  ) USING p_user_id, p_start INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_effective_record(text, uuid, jsonb, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_effective_record(text, uuid, jsonb, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.insert_effective_record(text, uuid, jsonb, date) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prisma_app') THEN
    GRANT EXECUTE ON FUNCTION public.insert_effective_record(text, uuid, jsonb, date) TO prisma_app;
  END IF;
END $$;

-- ─── 3c. effective_record_at() ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.effective_record_at(
  p_table   text,
  p_user_id uuid,
  p_date    date DEFAULT CURRENT_DATE
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_table NOT IN ('ec_job_information', 'ec_compensation', 'ec_personal_information') THEN
    RAISE EXCEPTION 'Invalid table: %', p_table;
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT to_jsonb(t) FROM public.%I t WHERE t.user_id = $1 AND t.start_date <= $2 AND (t.end_date IS NULL OR t.end_date > $2) LIMIT 1',
    p_table
  ) USING p_user_id, p_date;
END;
$$;

REVOKE ALL ON FUNCTION public.effective_record_at(text, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.effective_record_at(text, uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.effective_record_at(text, uuid, date) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prisma_app') THEN
    GRANT EXECUTE ON FUNCTION public.effective_record_at(text, uuid, date) TO prisma_app;
  END IF;
END $$;

-- ─── 3d. anonymize_user() — admin-only, tenant-scoped, audit log ──
CREATE OR REPLACE FUNCTION public.anonymize_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_actor_id  uuid;
  v_token     text;
  v_map       jsonb := '{}'::jsonb;
  v_user      record;
  v_pi        record;
BEGIN
  SELECT u.id, u.tenant_id INTO v_actor_id, v_tenant_id
  FROM public.users u
  WHERE u.auth_uid = auth.uid()
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Caller not found';
  END IF;

  IF NOT public.is_tenant_admin() THEN
    RAISE EXCEPTION 'Only tenant admins can anonymize users';
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE id = p_user_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found in tenant: %', p_user_id;
  END IF;

  v_token := 'ANON-' || substr(md5(p_user_id::text || now()::text), 1, 8);

  v_map := jsonb_build_object(
    'original_first_name', v_user.first_name,
    'original_last_name',  v_user.last_name,
    'original_email',      v_user.email,
    'token', v_token
  );

  UPDATE public.users SET
    first_name    = v_token,
    last_name     = 'ANONIMIZADO',
    email         = v_token || '@removed.local',
    is_anonymized = true,
    deleted_at    = now(),
    status        = 'TERMINATED',
    updated_at    = now()
  WHERE id = p_user_id AND tenant_id = v_tenant_id;

  FOR v_pi IN SELECT id FROM public.ec_personal_information WHERE user_id = p_user_id AND tenant_id = v_tenant_id LOOP
    UPDATE public.ec_personal_information SET
      first_name              = v_token,
      last_name               = 'ANONIMIZADO',
      middle_name             = NULL,
      phone                   = NULL,
      personal_email          = NULL,
      national_id             = NULL,
      tax_id                  = NULL,
      imss_number             = NULL,
      address_line1           = NULL,
      address_line2           = NULL,
      city                    = NULL,
      state                   = NULL,
      postal_code             = NULL,
      emergency_contact_name  = NULL,
      emergency_contact_phone = NULL
    WHERE id = v_pi.id;
  END LOOP;

  PERFORM public.write_audit_log(
    v_tenant_id,
    v_actor_id,
    'arco.anonymize',
    'users',
    p_user_id::text,
    v_map
  );

  RETURN v_map;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_user(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.anonymize_user(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.anonymize_user(uuid) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prisma_app') THEN
    GRANT EXECUTE ON FUNCTION public.anonymize_user(uuid) TO prisma_app;
  END IF;
END $$;

-- ─── 3e. export_user_data() — subject + admin, tenant-scoped ──────
CREATE OR REPLACE FUNCTION public.export_user_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_actor_id  uuid;
  v_result    jsonb := '{}'::jsonb;
  v_user      jsonb;
  v_jobs      jsonb;
  v_comp      jsonb;
  v_pi        jsonb;
BEGIN
  SELECT u.id, u.tenant_id INTO v_actor_id, v_tenant_id
  FROM public.users u
  WHERE u.auth_uid = auth.uid()
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Caller not found';
  END IF;

  IF v_actor_id <> p_user_id AND NOT public.is_tenant_admin() THEN
    RAISE EXCEPTION 'Only the data subject or a tenant admin can export user data';
  END IF;

  SELECT to_jsonb(u.*) INTO v_user
    FROM public.users u
    WHERE u.id = p_user_id AND u.tenant_id = v_tenant_id;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(j.*) ORDER BY j.start_date DESC), '[]'::jsonb)
    INTO v_jobs
    FROM public.ec_job_information j
    WHERE j.user_id = p_user_id AND j.tenant_id = v_tenant_id;

  SELECT coalesce(jsonb_agg(to_jsonb(c.*) ORDER BY c.start_date DESC), '[]'::jsonb)
    INTO v_comp
    FROM public.ec_compensation c
    WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant_id;

  SELECT coalesce(jsonb_agg(to_jsonb(p.*) ORDER BY p.start_date DESC), '[]'::jsonb)
    INTO v_pi
    FROM public.ec_personal_information p
    WHERE p.user_id = p_user_id AND p.tenant_id = v_tenant_id;

  v_result := jsonb_build_object(
    'user',                 v_user,
    'job_information',      v_jobs,
    'compensation',         v_comp,
    'personal_information', v_pi,
    'exported_at',          now()::text
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.export_user_data(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.export_user_data(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.export_user_data(uuid) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prisma_app') THEN
    GRANT EXECUTE ON FUNCTION public.export_user_data(uuid) TO prisma_app;
  END IF;
END $$;
