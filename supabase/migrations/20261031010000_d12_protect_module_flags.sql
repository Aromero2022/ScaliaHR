-- D12 — Licensing by module flag
-- Module flags (is_*_active) are licensing attributes controlled by the
-- platform, not by tenant owners.  Only service_role / admin client can
-- change them.  This migration revokes UPDATE on the flag columns from
-- authenticated, leaving only name, domain and updated_at writable by
-- the owner (the row-level policy still limits UPDATE to owners).

REVOKE UPDATE (
  is_ec_active, is_pmgm_active, is_sdm_active, is_rcm_active, is_lms_active,
  is_onb_active, is_comp_active, is_wfa_active, is_wfp_active, is_tme_active,
  is_tih_active, is_pos_mgmt_active
) ON public.tenants FROM authenticated;
