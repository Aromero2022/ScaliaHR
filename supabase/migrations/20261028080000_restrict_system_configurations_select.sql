-- Restrict SELECT on system_configurations to tenant admins.
-- Previously any authenticated tenant member could read all config rows;
-- now only users passing is_tenant_admin() can SELECT.

ALTER POLICY "system_configurations_select"
  ON public.system_configurations
  USING (tenant_id = requesting_tenant_id() AND is_tenant_admin());
