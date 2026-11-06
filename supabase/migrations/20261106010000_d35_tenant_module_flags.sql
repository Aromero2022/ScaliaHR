-- D35 — Module flags for the per-tenant cache (Phase 9b, PR 5)
--
-- Every page reads the tenant's module flags. The web server now caches them
-- per tenant (unstable_cache, tag tenant:<id>:modules) and fills the cache
-- outside any request, so it cannot use the user's session. This function
-- returns only the flags of one tenant, for the server's prisma_app role; the
-- server passes the tenant id from the verified token. Expand-only: nothing
-- existing changes.

CREATE FUNCTION public.tenant_module_flags(p_tenant_id uuid)
RETURNS TABLE (
  is_ec_active boolean,
  is_pmgm_active boolean,
  is_sdm_active boolean,
  is_rcm_active boolean,
  is_lms_active boolean,
  is_onb_active boolean,
  is_comp_active boolean,
  is_wfa_active boolean,
  is_wfp_active boolean,
  is_tme_active boolean,
  is_tih_active boolean,
  is_pos_mgmt_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.is_ec_active, t.is_pmgm_active, t.is_sdm_active, t.is_rcm_active,
         t.is_lms_active, t.is_onb_active, t.is_comp_active, t.is_wfa_active,
         t.is_wfp_active, t.is_tme_active, t.is_tih_active, t.is_pos_mgmt_active
  FROM public.tenants t
  WHERE t.id = p_tenant_id;
$$;

REVOKE EXECUTE ON FUNCTION public.tenant_module_flags(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_module_flags(uuid) TO prisma_app;
