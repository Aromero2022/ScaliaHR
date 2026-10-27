-- tenants had a FOR ALL policy (id = tenant claim), so any member could
-- INSERT or UPDATE their tenant row, including the module flags.
-- Now: SELECT for members of the tenant; UPDATE only for the owner and only on
-- descriptive fields and module flags; no INSERT or DELETE for authenticated
-- (tenants are created through createTenant with the admin client).

DROP POLICY IF EXISTS tenant_isolation_all ON public.tenants;

CREATE POLICY tenants_owner_update ON public.tenants
  FOR UPDATE TO authenticated
  USING (id = public.requesting_tenant_id() AND public.has_app_role('owner'))
  WITH CHECK (id = public.requesting_tenant_id() AND public.has_app_role('owner'));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tenants FROM anon, authenticated;
GRANT UPDATE (
  name, domain,
  is_ec_active, is_pmgm_active, is_sdm_active, is_rcm_active, is_lms_active,
  is_onb_active, is_comp_active, is_wfa_active, is_wfp_active, is_tme_active,
  is_tih_active, is_pos_mgmt_active,
  updated_at
) ON public.tenants TO authenticated;
