-- D47 — Reads by RBP population (Phase 9c, security PR before PR 6)
--
-- Personal, pay and talent data stop being readable by the whole tenant or by
-- anyone holding an is_admin_role role. A person reads their own rows plus
-- the population their role grants allow for the permission that guards the
-- data (D14), the same answer can() gives. Writes do not change here: they
-- still go through insert_effective_record (app_role) and the existing
-- RESTRICTIVE write policies (Known Risk, Phase 11).
--
-- The population is defined once, in rbp_population_user_ids(). The policies
-- reach it through rbp_visible_user_ids() (for whoever runs the query); can()
-- reaches it through rbp_target_in_population() and loads its grants through
-- rbp_context(), both only for prisma_app, so can() does not depend on the
-- policies below.

-- ─── 1. Population, in one place ────────────────────────────────────────────

-- The module flag a permission key depends on (PERMISSION_MODULE_MAP in can.ts).
CREATE FUNCTION public.rbp_module_active(p_tenant_id uuid, p_permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((
    SELECT CASE split_part(p_permission_key, '.', 1)
      WHEN 'ec' THEN t.is_ec_active
      WHEN 'pmgm' THEN t.is_pmgm_active
      WHEN 'tih' THEN t.is_tih_active
      WHEN 'lms' THEN t.is_lms_active
      WHEN 'sdm' THEN t.is_sdm_active
      WHEN 'rcm' THEN t.is_rcm_active
      WHEN 'onb' THEN t.is_onb_active
      WHEN 'comp' THEN t.is_comp_active
      WHEN 'wfa' THEN t.is_wfa_active
      WHEN 'wfp' THEN t.is_wfp_active
      WHEN 'tme' THEN t.is_tme_active
      WHEN 'pos_mgmt' THEN t.is_pos_mgmt_active
      ELSE true
    END
    FROM public.tenants t
    WHERE t.id = p_tenant_id
  ), false);
$$;

-- Who is in a target population of p_user_id, inside the tenant.
CREATE FUNCTION public.rbp_population_user_ids(p_tenant_id uuid, p_user_id uuid, p_population text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id FROM public.users u
  WHERE p_population = 'all' AND u.tenant_id = p_tenant_id
  UNION
  SELECT u.id FROM public.users u
  WHERE p_population = 'self' AND u.tenant_id = p_tenant_id AND u.id = p_user_id
  UNION
  -- The manager of the current job record, as can() reads it.
  SELECT j.user_id FROM public.ec_job_information j
  WHERE p_population = 'direct_reports' AND j.tenant_id = p_tenant_id
    AND j.end_date IS NULL AND j.manager_id = p_user_id
  UNION
  SELECT t.id FROM public.users a
  JOIN public.users t ON t.tenant_id = a.tenant_id AND t.department_id = a.department_id
  WHERE p_population = 'same_department' AND a.tenant_id = p_tenant_id
    AND a.id = p_user_id AND a.department_id IS NOT NULL;
$$;

-- Everyone p_user_id may see with a permission: the union of the populations
-- of their grants of roles that hold it, if its module is active.
CREATE FUNCTION public.rbp_user_ids(p_tenant_id uuid, p_user_id uuid, p_permission_key text, p_action public.rbp_action)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id
  FROM (
    SELECT DISTINCT rg.target_population::text AS population
    FROM public.group_members gm
    JOIN public.role_grants rg ON rg.granted_group_id = gm.group_id AND rg.tenant_id = gm.tenant_id
    JOIN public.role_permissions rp ON rp.role_id = rg.role_id AND rp.tenant_id = rg.tenant_id
    WHERE gm.tenant_id = p_tenant_id AND gm.user_id = p_user_id
      AND rp.permission_key = p_permission_key AND rp.action = p_action
      AND public.rbp_module_active(p_tenant_id, p_permission_key)
  ) g
  CROSS JOIN LATERAL public.rbp_population_user_ids(p_tenant_id, p_user_id, g.population) AS p(id);
$$;

REVOKE ALL ON FUNCTION public.rbp_module_active(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rbp_population_user_ids(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rbp_user_ids(uuid, uuid, text, public.rbp_action) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 2. For the policies: whoever runs the query ────────────────────────────

-- The users the caller may see with a permission (own rows are added by each policy).
CREATE FUNCTION public.rbp_visible_user_ids(p_permission_key text, p_action public.rbp_action DEFAULT 'view')
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.rbp_user_ids(public.requesting_tenant_id(), public.current_app_user_id(), p_permission_key, p_action);
$$;

-- Whether the caller holds a permission at all, whatever its population
-- (permissions of a page or a tool: ARCO, the audit log, managing roles).
CREATE FUNCTION public.rbp_has_permission(p_permission_key text, p_action public.rbp_action DEFAULT 'view')
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.rbp_module_active(public.requesting_tenant_id(), p_permission_key)
    AND EXISTS (
      SELECT 1
      FROM public.group_members gm
      JOIN public.role_grants rg ON rg.granted_group_id = gm.group_id AND rg.tenant_id = gm.tenant_id
      JOIN public.role_permissions rp ON rp.role_id = rg.role_id AND rp.tenant_id = rg.tenant_id
      WHERE gm.tenant_id = public.requesting_tenant_id()
        AND gm.user_id = public.current_app_user_id()
        AND rp.permission_key = p_permission_key AND rp.action = p_action
    );
$$;

REVOKE ALL ON FUNCTION public.rbp_visible_user_ids(text, public.rbp_action) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.rbp_has_permission(text, public.rbp_action) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rbp_visible_user_ids(text, public.rbp_action) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbp_has_permission(text, public.rbp_action) TO authenticated;

-- ─── 3. For can(): only the server (prisma_app) ─────────────────────────────

-- The tenant row, grants and permissions of a user, as can() loaded them
-- before (it read role_grants and group_members as authenticated, which the
-- policies below now limit to the caller's own rows).
CREATE FUNCTION public.rbp_context(p_tenant_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH my_grants AS (
    SELECT rg.role_id, rg.target_population::text AS target_population
    FROM public.role_grants rg
    JOIN public.group_members gm ON gm.group_id = rg.granted_group_id AND gm.tenant_id = rg.tenant_id
    WHERE gm.user_id = p_user_id AND rg.tenant_id = p_tenant_id
  )
  SELECT jsonb_build_object(
    'tenant', (SELECT to_jsonb(t) FROM public.tenants t WHERE t.id = p_tenant_id),
    'grants', coalesce((SELECT jsonb_agg(jsonb_build_object('role_id', g.role_id, 'target_population', g.target_population)) FROM my_grants g), '[]'::jsonb),
    'permissions', coalesce((
      SELECT jsonb_agg(jsonb_build_object('role_id', rp.role_id, 'permission_key', rp.permission_key, 'action', rp.action::text, 'field_key', rp.field_key))
      FROM public.role_permissions rp
      WHERE rp.tenant_id = p_tenant_id AND rp.role_id IN (SELECT role_id FROM my_grants)
    ), '[]'::jsonb)
  );
$$;

-- Whether p_target is in a population of p_user_id (can()'s direct_reports and same_department).
CREATE FUNCTION public.rbp_target_in_population(p_tenant_id uuid, p_user_id uuid, p_target uuid, p_population text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rbp_population_user_ids(p_tenant_id, p_user_id, p_population) AS p(id) WHERE p.id = p_target
  );
$$;

REVOKE ALL ON FUNCTION public.rbp_context(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rbp_target_in_population(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rbp_context(uuid, uuid) TO prisma_app;
GRANT EXECUTE ON FUNCTION public.rbp_target_in_population(uuid, uuid, uuid, text) TO prisma_app;

-- ─── 4. Personal, job and pay data ──────────────────────────────────────────

ALTER POLICY ec_comp_access ON public.ec_compensation
  USING (
    user_id = (SELECT public.current_app_user_id())
    OR user_id IN (SELECT public.rbp_visible_user_ids('ec.view_compensation'))
  );

ALTER POLICY ec_personal_pii_access ON public.ec_personal_information
  USING (
    user_id = (SELECT public.current_app_user_id())
    OR user_id IN (SELECT public.rbp_visible_user_ids('ec.view_team_profiles'))
    OR user_id IN (SELECT public.rbp_visible_user_ids('ec.manage_employees'))
  );

-- Job records were readable by the whole tenant. The directory reads name,
-- title and department through directory_entries() instead.
CREATE POLICY ec_job_info_rbp_select ON public.ec_job_information
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    user_id = (SELECT public.current_app_user_id())
    OR user_id IN (SELECT public.rbp_visible_user_ids('ec.view_team_profiles'))
    OR user_id IN (SELECT public.rbp_visible_user_ids('ec.manage_employees'))
  );

-- ─── 5. Talent data ─────────────────────────────────────────────────────────

ALTER POLICY es_select ON public.employee_skills
  USING (
    tenant_id = (SELECT public.requesting_tenant_id())
    AND (
      user_id = (SELECT public.current_app_user_id())
      OR user_id IN (SELECT public.rbp_visible_user_ids('tih.employee_skills'))
    )
  );

ALTER POLICY goals_user_visibility ON public.performance_goals
  USING (
    user_id = (SELECT public.current_app_user_id())
    OR user_id IN (SELECT public.rbp_visible_user_ids('pmgm.manage_team_goals', 'edit'))
    OR user_id IN (SELECT public.rbp_visible_user_ids('pmgm.manage_goal_plans', 'edit'))
  );

-- Private feedback stays between its author and its subject.
ALTER POLICY feedback_participant_visibility ON public.continuous_feedbacks
  USING (
    author_id = (SELECT public.current_app_user_id())
    OR subject_id = (SELECT public.current_app_user_id())
    OR (
      visibility <> 'PRIVATE'
      AND subject_id IN (SELECT public.rbp_visible_user_ids('pmgm.view_team_feedback'))
    )
  );

-- ─── 6. Permission-level data ───────────────────────────────────────────────

ALTER POLICY arco_select ON public.arco_requests
  USING (
    tenant_id = (SELECT public.requesting_tenant_id())
    AND (
      subject_id = (SELECT public.current_app_user_id())
      OR (SELECT public.rbp_has_permission('arco.manage'))
    )
  );

ALTER POLICY audit_logs_select ON public.audit_logs
  USING (
    tenant_id = (SELECT public.requesting_tenant_id())
    AND (SELECT public.rbp_has_permission('admin.view_audit_logs'))
  );

-- Who is in which group, and which roles each group holds, told anyone who the
-- administrators are. Now: one's own, or whoever administers RBP.
ALTER POLICY group_members_select ON public.group_members
  USING (
    tenant_id = (SELECT public.requesting_tenant_id())
    AND (
      user_id = (SELECT public.current_app_user_id())
      OR (SELECT public.rbp_has_permission('admin.manage_roles', 'edit'))
    )
  );

ALTER POLICY role_grants_select ON public.role_grants
  USING (
    tenant_id = (SELECT public.requesting_tenant_id())
    AND (
      granted_group_id IN (
        SELECT gm.group_id FROM public.group_members gm
        WHERE gm.tenant_id = (SELECT public.requesting_tenant_id())
          AND gm.user_id = (SELECT public.current_app_user_id())
      )
      OR (SELECT public.rbp_has_permission('admin.manage_roles', 'edit'))
    )
  );

ALTER POLICY lms_user_map_select ON public.lms_user_map
  USING (
    tenant_id = (SELECT public.requesting_tenant_id())
    AND (
      user_id = (SELECT public.current_app_user_id())
      OR (SELECT public.rbp_has_permission('admin.manage_roles', 'edit'))
    )
  );

-- ─── 7. Closed until they have a screen (Phase 18a) ─────────────────────────

CREATE POLICY job_informations_closed ON public.job_informations
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY succession_nominees_closed ON public.succession_nominees
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY talent_pool_entries_closed ON public.talent_pool_entries
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ─── 8. Talent scores of users ──────────────────────────────────────────────

-- performance_score and potential_score leave the columns anon and
-- authenticated may select; every other column stays. A column added later is
-- not readable until it is granted here. prisma_app had its own SELECT on the
-- whole table (app_roles), so Prisma would still read every score of the
-- tenant: it gets the same columns.
REVOKE SELECT ON public.users FROM anon, authenticated, prisma_app;
GRANT SELECT (
  id, tenant_id, auth_uid, email, first_name, last_name, employee_id, hire_date, status,
  deleted_at, is_anonymized, department_id, job_info_id, created_at, updated_at, position_id
) ON public.users TO anon, authenticated, prisma_app;

-- Own scores, or those of the population of ec.manage_employees (until Phase 18a).
CREATE FUNCTION public.talent_scores(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, performance_score double precision, potential_score double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, u.performance_score, u.potential_score
  FROM public.users u
  WHERE u.tenant_id = public.requesting_tenant_id()
    AND u.id = ANY (p_user_ids)
    AND (
      u.id = public.current_app_user_id()
      OR u.id IN (SELECT public.rbp_visible_user_ids('ec.manage_employees'))
    );
$$;

REVOKE ALL ON FUNCTION public.talent_scores(uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.talent_scores(uuid[]) TO authenticated;

-- ─── 9. The directory ───────────────────────────────────────────────────────

-- Name, current title and current department of the tenant's people, for the
-- employee list. Only those columns, and only with ec.view_org_chart; without
-- it the call fails (42501) instead of answering an empty directory.
CREATE FUNCTION public.directory_entries(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, first_name text, last_name text, job_title text, department_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.rbp_has_permission('ec.view_org_chart') THEN
    RAISE EXCEPTION 'Not authorized: ec.view_org_chart' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT u.id, u.first_name, u.last_name, j.job_title, d.name
    FROM public.users u
    LEFT JOIN public.ec_job_information j
      ON j.tenant_id = u.tenant_id AND j.user_id = u.id AND j.end_date IS NULL
    LEFT JOIN public.departments d
      ON d.tenant_id = j.tenant_id AND d.id = j.department_id
    WHERE u.tenant_id = public.requesting_tenant_id()
      AND u.id = ANY (p_user_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.directory_entries(uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.directory_entries(uuid[]) TO authenticated;

-- ─── 10. ec.view_compensation ───────────────────────────────────────────────

-- The compensation of the employee detail had no permission of its own (it
-- was "admin or team"). Tenants that exist get it on the roles that saw it:
-- Owner and HR Administrator (all) and Manager (direct reports).
INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action)
SELECT pr.tenant_id, pr.id, 'ec.view_compensation', 'view'
FROM public.permission_roles pr
WHERE pr.name IN ('Owner', 'HR Administrator', 'Manager')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = pr.id AND rp.permission_key = 'ec.view_compensation' AND rp.action = 'view'
  );
