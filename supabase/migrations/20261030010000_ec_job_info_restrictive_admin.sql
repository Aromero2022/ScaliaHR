-- ═══════════════════════════════════════════════════════════════════
-- RESTRICTIVE admin-only INSERT / UPDATE on ec_job_information
--
-- The existing PERMISSIVE policies allow any authenticated user in the
-- tenant to INSERT/UPDATE. This migration adds RESTRICTIVE policies
-- that narrow writes to tenant admins only (is_tenant_admin() checks
-- RBP group membership via role_grants + permission_roles.is_admin_role).
--
-- Note: insert_effective_record() is SECURITY DEFINER and checks
-- has_app_role('owner') OR has_app_role('hr_admin') — a JWT-based
-- check, not RBP-based. Both paths must pass for a write to succeed
-- through the RPC. See ARCHITECTURE.md Known Risk: "dual admin truth".
-- ═══════════════════════════════════════════════════════════════════

CREATE POLICY ec_job_info_admin_insert
  ON public.ec_job_information
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.is_tenant_admin()));

CREATE POLICY ec_job_info_admin_update
  ON public.ec_job_information
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.is_tenant_admin()));
