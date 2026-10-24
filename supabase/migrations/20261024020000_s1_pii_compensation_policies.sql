-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  S1 Step 4 — PII & Compensation RESTRICTIVE policies              ║
-- ║                                                                    ║
-- ║  Helpers: current_app_user_id(), has_app_role()                    ║
-- ║  RESTRICTIVE SELECT on ec_personal_information & ec_compensation:  ║
-- ║    own records + direct manager + admin                            ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════
-- 1. HELPER: current_app_user_id()
--    Returns the public.users.id for the current auth.uid() + tenant
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT u.id
  FROM public.users u
  WHERE u.auth_uid = auth.uid()
    AND u.tenant_id = public.requesting_tenant_id()
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.current_app_user_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_app_user_id() FROM anon;
GRANT  EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.current_app_user_id() TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prisma_app') THEN
    GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO prisma_app;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 2. HELPER: has_app_role(role text)
--    Checks the app_role claim in the JWT
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.has_app_role(p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::json ->> 'app_role',
    ''
  ) = p_role;
$$;

REVOKE EXECUTE ON FUNCTION public.has_app_role(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_app_role(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.has_app_role(text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.has_app_role(text) TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prisma_app') THEN
    GRANT EXECUTE ON FUNCTION public.has_app_role(text) TO prisma_app;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 3. RESTRICTIVE SELECT on ec_personal_information
--    Only own records, direct manager, or admin
-- ═══════════════════════════════════════════════════════════════════

CREATE POLICY ec_personal_pii_access ON public.ec_personal_information
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    user_id = public.current_app_user_id()
    OR public.is_tenant_admin()
    OR EXISTS (
      SELECT 1 FROM public.ec_job_information eji
      WHERE eji.user_id = ec_personal_information.user_id
        AND eji.manager_id = public.current_app_user_id()
        AND eji.tenant_id = public.requesting_tenant_id()
        AND eji.end_date IS NULL
    )
  );

-- ═══════════════════════════════════════════════════════════════════
-- 4. RESTRICTIVE SELECT on ec_compensation
--    Only own records, direct manager, or admin
-- ═══════════════════════════════════════════════════════════════════

CREATE POLICY ec_comp_access ON public.ec_compensation
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    user_id = public.current_app_user_id()
    OR public.is_tenant_admin()
    OR EXISTS (
      SELECT 1 FROM public.ec_job_information eji
      WHERE eji.user_id = ec_compensation.user_id
        AND eji.manager_id = public.current_app_user_id()
        AND eji.tenant_id = public.requesting_tenant_id()
        AND eji.end_date IS NULL
    )
  );

-- ═══════════════════════════════════════════════════════════════════
-- 5. RESTRICTIVE INSERT/UPDATE on ec_personal_information
--    Only admin can write PII
-- ═══════════════════════════════════════════════════════════════════

CREATE POLICY ec_personal_admin_write ON public.ec_personal_information
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin());

CREATE POLICY ec_personal_admin_update ON public.ec_personal_information
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin());

-- ═══════════════════════════════════════════════════════════════════
-- 6. RESTRICTIVE INSERT/UPDATE on ec_compensation
--    Only admin can write compensation
-- ═══════════════════════════════════════════════════════════════════

CREATE POLICY ec_comp_admin_write ON public.ec_compensation
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin());

CREATE POLICY ec_comp_admin_update ON public.ec_compensation
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin());
