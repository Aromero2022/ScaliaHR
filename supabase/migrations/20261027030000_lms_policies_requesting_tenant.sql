-- The lms_* policies cast the raw tenant_id claim to uuid. For a signed-in
-- user without tenant the claim is '' and every query on these tables failed
-- with 22P02 instead of returning no rows. Use requesting_tenant_id(), the
-- single tenant function, which maps '' to NULL.

DROP POLICY IF EXISTS lms_tenant_map_select ON public.lms_tenant_map;
DROP POLICY IF EXISTS lms_tenant_map_insert ON public.lms_tenant_map;
DROP POLICY IF EXISTS lms_tenant_map_update ON public.lms_tenant_map;
DROP POLICY IF EXISTS lms_user_map_select ON public.lms_user_map;
DROP POLICY IF EXISTS lms_user_map_insert ON public.lms_user_map;
DROP POLICY IF EXISTS lms_user_map_update ON public.lms_user_map;

CREATE POLICY lms_tenant_map_select ON public.lms_tenant_map
  FOR SELECT TO authenticated
  USING (tenant_id = public.requesting_tenant_id());

CREATE POLICY lms_tenant_map_insert ON public.lms_tenant_map
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.requesting_tenant_id());

CREATE POLICY lms_tenant_map_update ON public.lms_tenant_map
  FOR UPDATE TO authenticated
  USING (tenant_id = public.requesting_tenant_id())
  WITH CHECK (tenant_id = public.requesting_tenant_id());

CREATE POLICY lms_user_map_select ON public.lms_user_map
  FOR SELECT TO authenticated
  USING (tenant_id = public.requesting_tenant_id());

CREATE POLICY lms_user_map_insert ON public.lms_user_map
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.requesting_tenant_id());

CREATE POLICY lms_user_map_update ON public.lms_user_map
  FOR UPDATE TO authenticated
  USING (tenant_id = public.requesting_tenant_id())
  WITH CHECK (tenant_id = public.requesting_tenant_id());
