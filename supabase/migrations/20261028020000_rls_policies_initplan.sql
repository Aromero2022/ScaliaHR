-- Supabase advisor "Auth RLS Initialization Plan": calls to auth.uid(),
-- auth.jwt(), current_setting() and the tenant/role helpers inside RLS
-- policies were evaluated once per row. Wrapping them in (SELECT ...) makes
-- the planner evaluate them once per statement (initPlan). Expressions are
-- otherwise unchanged; generated from pg_policies deparsed with
-- search_path = '' so every name is schema-qualified.

ALTER POLICY "arco_insert" ON public."arco_requests"
  WITH CHECK (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "arco_select" ON public."arco_requests"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND ((subject_id = ( SELECT u.id
   FROM public.users u
  WHERE ((u.auth_uid = (SELECT auth.uid())) AND (u.tenant_id = (SELECT public.requesting_tenant_id())))
 LIMIT 1)) OR (SELECT public.is_tenant_admin()))));

ALTER POLICY "arco_update" ON public."arco_requests"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "audit_logs_insert" ON public."audit_logs"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "audit_logs_select" ON public."audit_logs"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "business_rules_tenant_delete" ON public."business_rules"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "business_rules_tenant_insert" ON public."business_rules"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "business_rules_tenant_select" ON public."business_rules"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "business_rules_tenant_update" ON public."business_rules"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "business_units_insert" ON public."business_units"
  WITH CHECK (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "business_units_select" ON public."business_units"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "business_units_update" ON public."business_units"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "feedback_author_insert" ON public."continuous_feedbacks"
  WITH CHECK ((author_id = ( SELECT users.id
   FROM public.users
  WHERE ((users.auth_uid = (SELECT auth.uid())) AND (users.tenant_id = (SELECT public.requesting_tenant_id())))
 LIMIT 1)));

ALTER POLICY "feedback_author_update" ON public."continuous_feedbacks"
  USING (((author_id = ( SELECT users.id
   FROM public.users
  WHERE ((users.auth_uid = (SELECT auth.uid())) AND (users.tenant_id = (SELECT public.requesting_tenant_id())))
 LIMIT 1)) OR (SELECT public.is_tenant_admin())));

ALTER POLICY "feedback_participant_visibility" ON public."continuous_feedbacks"
  USING (((author_id = ( SELECT users.id
   FROM public.users
  WHERE ((users.auth_uid = (SELECT auth.uid())) AND (users.tenant_id = (SELECT public.requesting_tenant_id())))
 LIMIT 1)) OR (subject_id = ( SELECT users.id
   FROM public.users
  WHERE ((users.auth_uid = (SELECT auth.uid())) AND (users.tenant_id = (SELECT public.requesting_tenant_id())))
 LIMIT 1)) OR (SELECT public.is_tenant_admin())));

ALTER POLICY "feedback_tenant_delete" ON public."continuous_feedbacks"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "feedback_tenant_insert" ON public."continuous_feedbacks"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "feedback_tenant_select" ON public."continuous_feedbacks"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "feedback_tenant_update" ON public."continuous_feedbacks"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "departments_tenant_delete" ON public."departments"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "departments_tenant_insert" ON public."departments"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "departments_tenant_select" ON public."departments"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "departments_tenant_update" ON public."departments"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "ec_comp_access" ON public."ec_compensation"
  USING (((user_id = (SELECT public.current_app_user_id())) OR (SELECT public.is_tenant_admin()) OR (EXISTS ( SELECT 1
   FROM public.ec_job_information eji
  WHERE ((eji.user_id = ec_compensation.user_id) AND (eji.manager_id = (SELECT public.current_app_user_id())) AND (eji.tenant_id = (SELECT public.requesting_tenant_id())) AND (eji.end_date IS NULL))))));

ALTER POLICY "ec_comp_admin_update" ON public."ec_compensation"
  USING ((SELECT public.is_tenant_admin()));

ALTER POLICY "ec_comp_admin_write" ON public."ec_compensation"
  WITH CHECK ((SELECT public.is_tenant_admin()));

ALTER POLICY "ec_comp_insert" ON public."ec_compensation"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "ec_comp_select" ON public."ec_compensation"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "ec_comp_update" ON public."ec_compensation"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "ec_job_info_insert" ON public."ec_job_information"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "ec_job_info_select" ON public."ec_job_information"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "ec_job_info_update" ON public."ec_job_information"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "ec_personal_admin_update" ON public."ec_personal_information"
  USING ((SELECT public.is_tenant_admin()));

ALTER POLICY "ec_personal_admin_write" ON public."ec_personal_information"
  WITH CHECK ((SELECT public.is_tenant_admin()));

ALTER POLICY "ec_personal_insert" ON public."ec_personal_information"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "ec_personal_pii_access" ON public."ec_personal_information"
  USING (((user_id = (SELECT public.current_app_user_id())) OR (SELECT public.is_tenant_admin()) OR (EXISTS ( SELECT 1
   FROM public.ec_job_information eji
  WHERE ((eji.user_id = ec_personal_information.user_id) AND (eji.manager_id = (SELECT public.current_app_user_id())) AND (eji.tenant_id = (SELECT public.requesting_tenant_id())) AND (eji.end_date IS NULL))))));

ALTER POLICY "ec_personal_select" ON public."ec_personal_information"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "ec_personal_update" ON public."ec_personal_information"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "es_insert" ON public."employee_skills"
  WITH CHECK (((tenant_id = (SELECT public.requesting_tenant_id())) AND (user_id = ( SELECT u.id
   FROM public.users u
  WHERE ((u.auth_uid = (SELECT auth.uid())) AND (u.tenant_id = (SELECT public.requesting_tenant_id())))
 LIMIT 1)) AND (manager_assessed_level IS NULL) AND (manager_assessed_at IS NULL) AND (manager_assessed_by IS NULL)));

ALTER POLICY "es_select" ON public."employee_skills"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND ((user_id = ( SELECT u.id
   FROM public.users u
  WHERE ((u.auth_uid = (SELECT auth.uid())) AND (u.tenant_id = (SELECT public.requesting_tenant_id())))
 LIMIT 1)) OR (SELECT public.is_tenant_admin()) OR (EXISTS ( SELECT 1
   FROM public.ec_job_information eji
  WHERE ((eji.user_id = employee_skills.user_id) AND (eji.manager_id = ( SELECT u.id
           FROM public.users u
          WHERE ((u.auth_uid = (SELECT auth.uid())) AND (u.tenant_id = (SELECT public.requesting_tenant_id())))
         LIMIT 1)) AND (eji.tenant_id = (SELECT public.requesting_tenant_id())) AND (eji.end_date IS NULL)))))));

ALTER POLICY "es_update" ON public."employee_skills"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND (user_id = ( SELECT u.id
   FROM public.users u
  WHERE ((u.auth_uid = (SELECT auth.uid())) AND (u.tenant_id = (SELECT public.requesting_tenant_id())))
 LIMIT 1))))
  WITH CHECK (((tenant_id = (SELECT public.requesting_tenant_id())) AND (user_id = ( SELECT u.id
   FROM public.users u
  WHERE ((u.auth_uid = (SELECT auth.uid())) AND (u.tenant_id = (SELECT public.requesting_tenant_id())))
 LIMIT 1))));

ALTER POLICY "group_members_insert" ON public."group_members"
  WITH CHECK (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "group_members_select" ON public."group_members"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "group_members_update" ON public."group_members"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "job_classifications_tenant_delete" ON public."job_classifications"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "job_classifications_tenant_insert" ON public."job_classifications"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "job_classifications_tenant_select" ON public."job_classifications"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "job_classifications_tenant_update" ON public."job_classifications"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "job_families_tenant_delete" ON public."job_families"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "job_families_tenant_insert" ON public."job_families"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "job_families_tenant_select" ON public."job_families"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "job_families_tenant_update" ON public."job_families"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "job_informations_tenant_delete" ON public."job_informations"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "job_informations_tenant_insert" ON public."job_informations"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "job_informations_tenant_select" ON public."job_informations"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "job_informations_tenant_update" ON public."job_informations"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "jrs_insert" ON public."job_role_skills"
  WITH CHECK (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "jrs_select" ON public."job_role_skills"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "jrs_update" ON public."job_role_skills"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "job_roles_tenant_delete" ON public."job_roles"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "job_roles_tenant_insert" ON public."job_roles"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "job_roles_tenant_select" ON public."job_roles"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "job_roles_tenant_update" ON public."job_roles"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "legal_entities_insert" ON public."legal_entities"
  WITH CHECK (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "legal_entities_select" ON public."legal_entities"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "legal_entities_update" ON public."legal_entities"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "lms_tenant_map_insert" ON public."lms_tenant_map"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "lms_tenant_map_select" ON public."lms_tenant_map"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "lms_tenant_map_update" ON public."lms_tenant_map"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())))
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "lms_user_map_insert" ON public."lms_user_map"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "lms_user_map_select" ON public."lms_user_map"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "lms_user_map_update" ON public."lms_user_map"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())))
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "locations_insert" ON public."locations"
  WITH CHECK (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "locations_select" ON public."locations"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "locations_update" ON public."locations"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "object_definitions_tenant_delete" ON public."object_definitions"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "object_definitions_tenant_insert" ON public."object_definitions"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "object_definitions_tenant_select" ON public."object_definitions"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "object_definitions_tenant_update" ON public."object_definitions"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "goals_tenant_delete" ON public."performance_goals"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "goals_tenant_insert" ON public."performance_goals"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "goals_tenant_select" ON public."performance_goals"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "goals_tenant_update" ON public."performance_goals"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "goals_user_insert" ON public."performance_goals"
  WITH CHECK ((user_id = ( SELECT users.id
   FROM public.users
  WHERE ((users.auth_uid = (SELECT auth.uid())) AND (users.tenant_id = (SELECT public.requesting_tenant_id())))
 LIMIT 1)));

ALTER POLICY "goals_user_update" ON public."performance_goals"
  USING (((user_id = ( SELECT users.id
   FROM public.users
  WHERE ((users.auth_uid = (SELECT auth.uid())) AND (users.tenant_id = (SELECT public.requesting_tenant_id())))
 LIMIT 1)) OR (SELECT public.is_tenant_admin())));

ALTER POLICY "goals_user_visibility" ON public."performance_goals"
  USING (((user_id = ( SELECT users.id
   FROM public.users
  WHERE ((users.auth_uid = (SELECT auth.uid())) AND (users.tenant_id = (SELECT public.requesting_tenant_id())))
 LIMIT 1)) OR (SELECT public.is_tenant_admin())));

ALTER POLICY "permission_groups_insert" ON public."permission_groups"
  WITH CHECK (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "permission_groups_select" ON public."permission_groups"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "permission_groups_update" ON public."permission_groups"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "permission_roles_insert" ON public."permission_roles"
  WITH CHECK (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "permission_roles_select" ON public."permission_roles"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "permission_roles_update" ON public."permission_roles"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "positions_tenant_delete" ON public."positions"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "positions_tenant_insert" ON public."positions"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "positions_tenant_select" ON public."positions"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "positions_tenant_update" ON public."positions"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "role_grants_insert" ON public."role_grants"
  WITH CHECK (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "role_grants_select" ON public."role_grants"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "role_grants_update" ON public."role_grants"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "role_permissions_insert" ON public."role_permissions"
  WITH CHECK (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "role_permissions_select" ON public."role_permissions"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "role_permissions_update" ON public."role_permissions"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "so_insert" ON public."skill_ontology"
  WITH CHECK (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "so_select" ON public."skill_ontology"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "so_update" ON public."skill_ontology"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "nominees_tenant_delete" ON public."succession_nominees"
  USING ((EXISTS ( SELECT 1
   FROM public.succession_plans sp
  WHERE ((sp.id = succession_nominees.succession_plan_id) AND (sp.tenant_id = (SELECT public.requesting_tenant_id()))))));

ALTER POLICY "nominees_tenant_insert" ON public."succession_nominees"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.succession_plans sp
  WHERE ((sp.id = succession_nominees.succession_plan_id) AND (sp.tenant_id = (SELECT public.requesting_tenant_id()))))));

ALTER POLICY "nominees_tenant_select" ON public."succession_nominees"
  USING ((EXISTS ( SELECT 1
   FROM public.succession_plans sp
  WHERE ((sp.id = succession_nominees.succession_plan_id) AND (sp.tenant_id = (SELECT public.requesting_tenant_id()))))));

ALTER POLICY "nominees_tenant_update" ON public."succession_nominees"
  USING ((EXISTS ( SELECT 1
   FROM public.succession_plans sp
  WHERE ((sp.id = succession_nominees.succession_plan_id) AND (sp.tenant_id = (SELECT public.requesting_tenant_id()))))));

ALTER POLICY "succession_plans_tenant_delete" ON public."succession_plans"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "succession_plans_tenant_insert" ON public."succession_plans"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "succession_plans_tenant_select" ON public."succession_plans"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "succession_plans_tenant_update" ON public."succession_plans"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "system_configurations_insert" ON public."system_configurations"
  WITH CHECK (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "system_configurations_select" ON public."system_configurations"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "system_configurations_update" ON public."system_configurations"
  USING (((tenant_id = (SELECT public.requesting_tenant_id())) AND (SELECT public.is_tenant_admin())));

ALTER POLICY "pool_entries_tenant_delete" ON public."talent_pool_entries"
  USING ((EXISTS ( SELECT 1
   FROM public.talent_pools tp
  WHERE ((tp.id = talent_pool_entries.talent_pool_id) AND (tp.tenant_id = (SELECT public.requesting_tenant_id()))))));

ALTER POLICY "pool_entries_tenant_insert" ON public."talent_pool_entries"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.talent_pools tp
  WHERE ((tp.id = talent_pool_entries.talent_pool_id) AND (tp.tenant_id = (SELECT public.requesting_tenant_id()))))));

ALTER POLICY "pool_entries_tenant_select" ON public."talent_pool_entries"
  USING ((EXISTS ( SELECT 1
   FROM public.talent_pools tp
  WHERE ((tp.id = talent_pool_entries.talent_pool_id) AND (tp.tenant_id = (SELECT public.requesting_tenant_id()))))));

ALTER POLICY "pool_entries_tenant_update" ON public."talent_pool_entries"
  USING ((EXISTS ( SELECT 1
   FROM public.talent_pools tp
  WHERE ((tp.id = talent_pool_entries.talent_pool_id) AND (tp.tenant_id = (SELECT public.requesting_tenant_id()))))));

ALTER POLICY "talent_pools_tenant_delete" ON public."talent_pools"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "talent_pools_tenant_insert" ON public."talent_pools"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "talent_pools_tenant_select" ON public."talent_pools"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "talent_pools_tenant_update" ON public."talent_pools"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "tenant_isolation_select" ON public."tenants"
  USING ((id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "tenants_owner_update" ON public."tenants"
  USING (((id = (SELECT public.requesting_tenant_id())) AND (SELECT public.has_app_role('owner'::text))))
  WITH CHECK (((id = (SELECT public.requesting_tenant_id())) AND (SELECT public.has_app_role('owner'::text))));

ALTER POLICY "us_own_insert" ON public."user_settings"
  WITH CHECK (((user_id = (SELECT auth.uid())) AND ((active_tenant_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.user_tenant_memberships utm
  WHERE ((utm.user_id = (SELECT auth.uid())) AND (utm.tenant_id = user_settings.active_tenant_id) AND (utm.is_active = true)))))));

ALTER POLICY "us_own_read" ON public."user_settings"
  USING ((user_id = (SELECT auth.uid())));

ALTER POLICY "us_own_update" ON public."user_settings"
  USING ((user_id = (SELECT auth.uid())))
  WITH CHECK (((user_id = (SELECT auth.uid())) AND ((active_tenant_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.user_tenant_memberships utm
  WHERE ((utm.user_id = (SELECT auth.uid())) AND (utm.tenant_id = user_settings.active_tenant_id) AND (utm.is_active = true)))))));

ALTER POLICY "utm_own_read" ON public."user_tenant_memberships"
  USING ((user_id = (SELECT auth.uid())));

ALTER POLICY "users_tenant_delete" ON public."users"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "users_tenant_insert" ON public."users"
  WITH CHECK ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "users_tenant_select" ON public."users"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));

ALTER POLICY "users_tenant_update" ON public."users"
  USING ((tenant_id = (SELECT public.requesting_tenant_id())));
