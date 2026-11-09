-- D46 — No hard delete from the Data API (Phase 9c, correction before PR 6)
--
-- The rule is soft delete only: anon and authenticated never remove rows.
-- 1. Fifteen PERMISSIVE DELETE policies from the first migrations allowed it
--    inside the caller's tenant. Each is neutralized today by a RESTRICTIVE
--    no_hard_delete_authenticated policy (USING false), so removing one of
--    those would have opened it. They go; the RESTRICTIVE ones stay as a
--    second lock.
-- 2. Supabase's default grants gave DELETE on every table of public to anon
--    and authenticated (36 of 39 tables), and the default privileges of
--    postgres kept giving it to every new table (D25 removed TRUNCATE,
--    TRIGGER, REFERENCES and MAINTAIN, not DELETE). Both are revoked.
-- No screen deletes rows: only the operator scripts do, as postgres.

-- ─── 1. PERMISSIVE DELETE policies ──────────────────────────────────────────
DROP POLICY business_rules_tenant_delete ON public.business_rules;
DROP POLICY feedback_tenant_delete ON public.continuous_feedbacks;
DROP POLICY departments_tenant_delete ON public.departments;
DROP POLICY job_classifications_tenant_delete ON public.job_classifications;
DROP POLICY job_families_tenant_delete ON public.job_families;
DROP POLICY job_informations_tenant_delete ON public.job_informations;
DROP POLICY job_roles_tenant_delete ON public.job_roles;
DROP POLICY object_definitions_tenant_delete ON public.object_definitions;
DROP POLICY goals_tenant_delete ON public.performance_goals;
DROP POLICY positions_tenant_delete ON public.positions;
DROP POLICY nominees_tenant_delete ON public.succession_nominees;
DROP POLICY succession_plans_tenant_delete ON public.succession_plans;
DROP POLICY pool_entries_tenant_delete ON public.talent_pool_entries;
DROP POLICY talent_pools_tenant_delete ON public.talent_pools;
DROP POLICY users_tenant_delete ON public.users;

-- ─── 2. DELETE privilege ────────────────────────────────────────────────────
-- ALL TABLES covers tables, partitioned tables, views, materialized views and
-- foreign tables of the schema.
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Relations created by later migrations (owner postgres) start without it.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE DELETE ON TABLES FROM anon, authenticated;
