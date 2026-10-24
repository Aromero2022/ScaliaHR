-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  S1 — Step 5: RBP v1 → v2 Consolidation                          ║
-- ║                                                                    ║
-- ║  1. Migrate role_assignments data into role_grants                 ║
-- ║  2. Auto-populate group_members from criteria_json rules           ║
-- ║  3. Rewrite is_tenant_admin() to use v2 tables                    ║
-- ║  4. Drop role_assignments table                                    ║
-- ║  5. Drop permission_groups.criteria_json column                    ║
-- ║  6. Drop role_permissions.permission_name, enforce permission_key  ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════
-- 1. Migrate role_assignments → role_grants
--    Maps target_population_group's criteria_json to the enum.
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO public.role_grants (tenant_id, role_id, granted_group_id, target_population)
SELECT DISTINCT
  ra.tenant_id,
  ra.role_id,
  ra.granted_group_id,
  CASE
    WHEN pg_tp.criteria_json ->> 'type' = 'self'           THEN 'self'::target_population_type
    WHEN pg_tp.criteria_json ->> 'type' = 'direct_reports'  THEN 'direct_reports'::target_population_type
    WHEN pg_tp.criteria_json ->> 'type' = 'all'             THEN 'all'::target_population_type
    WHEN pg_tp.criteria_json ->> 'match' = 'has_direct_reports' THEN 'direct_reports'::target_population_type
    WHEN pg_tp.name ILIKE '%self%'   THEN 'self'::target_population_type
    WHEN pg_tp.name ILIKE '%direct%' THEN 'direct_reports'::target_population_type
    ELSE 'all'::target_population_type
  END
FROM public.role_assignments ra
JOIN public.permission_groups pg_tp ON pg_tp.id = ra.target_population_group_id
ON CONFLICT (role_id, granted_group_id, target_population) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Auto-populate group_members from criteria_json rules
--    Resolve dynamic criteria into explicit membership rows.
-- ═══════════════════════════════════════════════════════════════════

-- 2a. Groups matching "all employees" (type=all OR match=status+ACTIVE)
INSERT INTO public.group_members (tenant_id, group_id, user_id)
SELECT pg.tenant_id, pg.id, u.id
FROM public.permission_groups pg
JOIN public.users u
  ON u.tenant_id = pg.tenant_id
  AND u.status IN ('ACTIVE', 'active')
  AND u.deleted_at IS NULL
WHERE pg.criteria_json IS NOT NULL
  AND (
    pg.criteria_json ->> 'type' = 'all'
    OR (pg.criteria_json ->> 'match' = 'status' AND pg.criteria_json ->> 'status' = 'ACTIVE')
  )
ON CONFLICT (group_id, user_id) DO NOTHING;

-- 2b. Groups matching "has direct reports" (managers)
INSERT INTO public.group_members (tenant_id, group_id, user_id)
SELECT DISTINCT pg.tenant_id, pg.id, eji.manager_id
FROM public.permission_groups pg
JOIN public.ec_job_information eji
  ON eji.tenant_id = pg.tenant_id
  AND eji.end_date IS NULL
  AND eji.manager_id IS NOT NULL
WHERE pg.criteria_json IS NOT NULL
  AND pg.criteria_json ->> 'match' = 'has_direct_reports'
ON CONFLICT (group_id, user_id) DO NOTHING;

-- 2c. Groups matching admin role membership
--     For groups with {"match":"role","role":"..."}, add users who held that role
--     via role_assignments → role_id → permission_roles.name
INSERT INTO public.group_members (tenant_id, group_id, user_id)
SELECT DISTINCT pg.tenant_id, pg.id, gm_src.user_id
FROM public.permission_groups pg
JOIN public.role_assignments ra ON ra.granted_group_id = pg.id AND ra.tenant_id = pg.tenant_id
JOIN public.permission_roles pr ON pr.id = ra.role_id AND pr.is_admin_role = true
JOIN public.group_members gm_src ON gm_src.group_id = ra.granted_group_id
WHERE pg.criteria_json IS NOT NULL
  AND pg.criteria_json ->> 'match' = 'role'
ON CONFLICT (group_id, user_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Rewrite is_tenant_admin() for v2
--    Uses role_grants + group_members instead of role_assignments.
-- ═══════════════════════════════════════════════════════════════════

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
    FROM public.role_grants rg
    JOIN public.permission_roles pr ON pr.id = rg.role_id
    JOIN public.group_members gm ON gm.group_id = rg.granted_group_id
    WHERE pr.is_admin_role = true
      AND rg.tenant_id = public.requesting_tenant_id()
      AND gm.user_id = public.current_app_user_id()
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

-- ═══════════════════════════════════════════════════════════════════
-- 4. Drop role_assignments table
-- ═══════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS public.role_assignments CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- 5. Drop criteria_json from permission_groups
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.permission_groups DROP COLUMN IF EXISTS criteria_json;

-- ═══════════════════════════════════════════════════════════════════
-- 6. Finalize role_permissions: drop permission_name, enforce permission_key
-- ═══════════════════════════════════════════════════════════════════

UPDATE public.role_permissions
SET permission_key = permission_name
WHERE permission_key IS NULL AND permission_name IS NOT NULL;

ALTER TABLE public.role_permissions DROP COLUMN IF EXISTS permission_name;

ALTER TABLE public.role_permissions
  ALTER COLUMN permission_key SET NOT NULL;
