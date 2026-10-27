-- A user could set user_settings.active_tenant_id to any tenant, and
-- custom_access_token_hook copied it into the tenant_id claim without checking
-- membership, so every tenant-scoped policy then granted access to that tenant.
-- Both the hook and the user_settings policies now require an active membership.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claims      jsonb;
  v_user_id   uuid;
  v_tenant_id uuid;
  v_app_role  text;
BEGIN
  claims  := event->'claims';
  v_user_id := (event->>'user_id')::uuid;

  -- Active tenant from user_settings, only while the membership is active
  SELECT us.active_tenant_id INTO v_tenant_id
  FROM public.user_settings us
  JOIN public.user_tenant_memberships utm
    ON utm.user_id = us.user_id
   AND utm.tenant_id = us.active_tenant_id
   AND utm.is_active = true
  WHERE us.user_id = v_user_id;

  -- Otherwise the first active membership
  IF v_tenant_id IS NULL THEN
    SELECT utm.tenant_id INTO v_tenant_id
    FROM public.user_tenant_memberships utm
    WHERE utm.user_id = v_user_id
      AND utm.is_active = true
    ORDER BY utm.created_at
    LIMIT 1;
  END IF;

  IF v_tenant_id IS NOT NULL THEN
    SELECT utm.app_role INTO v_app_role
    FROM public.user_tenant_memberships utm
    WHERE utm.user_id = v_user_id
      AND utm.tenant_id = v_tenant_id
      AND utm.is_active = true;
  END IF;

  claims := jsonb_set(claims, '{tenant_id}', to_jsonb(COALESCE(v_tenant_id::text, '')));
  claims := jsonb_set(claims, '{app_role}',  to_jsonb(COALESCE(v_app_role, 'member')));

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

DROP POLICY IF EXISTS "us_own_insert" ON public.user_settings;
DROP POLICY IF EXISTS "us_own_update" ON public.user_settings;

CREATE POLICY "us_own_insert" ON public.user_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      user_settings.active_tenant_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.user_tenant_memberships utm
        WHERE utm.user_id = auth.uid()
          AND utm.tenant_id = user_settings.active_tenant_id
          AND utm.is_active = true
      )
    )
  );

CREATE POLICY "us_own_update" ON public.user_settings
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (
      user_settings.active_tenant_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.user_tenant_memberships utm
        WHERE utm.user_id = auth.uid()
          AND utm.tenant_id = user_settings.active_tenant_id
          AND utm.is_active = true
      )
    )
  );
