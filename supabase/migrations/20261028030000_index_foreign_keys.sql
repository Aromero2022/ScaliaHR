-- Supabase advisor "Unindexed foreign keys": the composite (tenant_id, col)
-- foreign keys from 20261027070000 and a few single-column ones had no index
-- whose leading columns match the key, so joins and ON DELETE checks scanned
-- the referencing table. One index per uncovered foreign key, same column order.
CREATE INDEX IF NOT EXISTS idx_arco_requests_tenant_id_requester_id_fk ON public.arco_requests (tenant_id, requester_id);
CREATE INDEX IF NOT EXISTS idx_arco_requests_tenant_id_subject_id_fk ON public.arco_requests (tenant_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id_user_id_fk ON public.audit_logs (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_business_units_tenant_id_legal_entity_id_fk ON public.business_units (tenant_id, legal_entity_id);
CREATE INDEX IF NOT EXISTS idx_continuous_feedbacks_tenant_id_author_id_fk ON public.continuous_feedbacks (tenant_id, author_id);
CREATE INDEX IF NOT EXISTS idx_continuous_feedbacks_tenant_id_subject_id_fk ON public.continuous_feedbacks (tenant_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_departments_tenant_id_business_unit_id_fk ON public.departments (tenant_id, business_unit_id);
CREATE INDEX IF NOT EXISTS idx_departments_tenant_id_legal_entity_id_fk ON public.departments (tenant_id, legal_entity_id);
CREATE INDEX IF NOT EXISTS idx_departments_tenant_id_location_id_fk ON public.departments (tenant_id, location_id);
CREATE INDEX IF NOT EXISTS idx_departments_tenant_id_parent_id_fk ON public.departments (tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_ec_compensation_tenant_id_user_id_fk ON public.ec_compensation (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ec_job_information_tenant_id_department_id_fk ON public.ec_job_information (tenant_id, department_id);
CREATE INDEX IF NOT EXISTS idx_ec_job_information_tenant_id_job_classification_id_fk ON public.ec_job_information (tenant_id, job_classification_id);
CREATE INDEX IF NOT EXISTS idx_ec_job_information_tenant_id_location_id_fk ON public.ec_job_information (tenant_id, location_id);
CREATE INDEX IF NOT EXISTS idx_ec_job_information_tenant_id_manager_id_fk ON public.ec_job_information (tenant_id, manager_id);
CREATE INDEX IF NOT EXISTS idx_ec_job_information_tenant_id_position_id_fk ON public.ec_job_information (tenant_id, position_id);
CREATE INDEX IF NOT EXISTS idx_ec_job_information_tenant_id_user_id_fk ON public.ec_job_information (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ec_personal_information_tenant_id_user_id_fk ON public.ec_personal_information (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_employee_skills_tenant_id_manager_assessed_by_fk ON public.employee_skills (tenant_id, manager_assessed_by);
CREATE INDEX IF NOT EXISTS idx_employee_skills_tenant_id_skill_id_fk ON public.employee_skills (tenant_id, skill_id);
CREATE INDEX IF NOT EXISTS idx_group_members_tenant_id_group_id_fk ON public.group_members (tenant_id, group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_tenant_id_user_id_fk ON public.group_members (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_job_classifications_tenant_id_job_role_id_fk ON public.job_classifications (tenant_id, job_role_id);
CREATE INDEX IF NOT EXISTS idx_job_informations_tenant_id_job_classification_id_fk ON public.job_informations (tenant_id, job_classification_id);
CREATE INDEX IF NOT EXISTS idx_job_informations_tenant_id_position_id_fk ON public.job_informations (tenant_id, position_id);
CREATE INDEX IF NOT EXISTS idx_job_role_skills_tenant_id_skill_id_fk ON public.job_role_skills (tenant_id, skill_id);
CREATE INDEX IF NOT EXISTS idx_job_roles_tenant_id_job_family_id_fk ON public.job_roles (tenant_id, job_family_id);
CREATE INDEX IF NOT EXISTS idx_performance_goals_tenant_id_user_id_fk ON public.performance_goals (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_positions_tenant_id_department_id_fk ON public.positions (tenant_id, department_id);
CREATE INDEX IF NOT EXISTS idx_positions_tenant_id_job_classification_id_fk ON public.positions (tenant_id, job_classification_id);
CREATE INDEX IF NOT EXISTS idx_positions_tenant_id_parent_position_id_fk ON public.positions (tenant_id, parent_position_id);
CREATE INDEX IF NOT EXISTS idx_role_grants_tenant_id_granted_group_id_fk ON public.role_grants (tenant_id, granted_group_id);
CREATE INDEX IF NOT EXISTS idx_role_grants_tenant_id_role_id_fk ON public.role_grants (tenant_id, role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_tenant_id_role_id_fk ON public.role_permissions (tenant_id, role_id);
CREATE INDEX IF NOT EXISTS idx_succession_nominees_user_id_fk ON public.succession_nominees (user_id);
CREATE INDEX IF NOT EXISTS idx_talent_pool_entries_user_id_fk ON public.talent_pool_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_user_settings_active_tenant_id_fk ON public.user_settings (active_tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id_department_id_fk ON public.users (tenant_id, department_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id_job_info_id_fk ON public.users (tenant_id, job_info_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id_position_id_fk ON public.users (tenant_id, position_id);
