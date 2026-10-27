-- custom_access_token_hook qualified its local variables with the function
-- name (custom_access_token_hook.user_id). PL/pgSQL only allows that for
-- parameters, so every call failed with 42P01 "missing FROM-clause entry for
-- table custom_access_token_hook" and GoTrue rejected every sign-in.
-- Same logic, locals renamed.

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
  SELECT us.active_tenant_id INTO v_tenant_id
  FROM public.user_settings us
  WHERE us.user_id = v_user_id;
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
