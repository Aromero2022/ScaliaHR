-- D21 — Tenant suspension
--
-- A suspended tenant keeps its data but nobody works in it:
--   * custom_access_token_hook stops putting it in tokens, so RLS hides every
--     row from its users as soon as their token refreshes (jwt_expiry = 900 s);
--   * the web middleware answers its subdomain and company code with the same
--     404 as a tenant that does not exist (apps/web/src/lib/tenant/host.ts);
--   * the worker drops its queued emails (public.email_branding, D20).
-- Only the platform suspends: authenticated keeps its column-level UPDATE grant
-- on name, domain, module flags and updated_at, which does not include this.

ALTER TABLE public.tenants ADD COLUMN suspended_at timestamptz;

COMMENT ON COLUMN public.tenants.suspended_at IS
  'Set by the platform only (D21). Non-null: tokens no longer carry the tenant and its emails are dropped.';

-- Same hook as 20261028060000_normalize_app_roles.sql, plus the tenant must not
-- be suspended in both lookups.
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
  JOIN public.user_tenant_memberships utm
    ON utm.user_id = us.user_id
   AND utm.tenant_id = us.active_tenant_id
   AND utm.is_active = true
  JOIN public.tenants t
    ON t.id = utm.tenant_id
   AND t.suspended_at IS NULL
  WHERE us.user_id = v_user_id;

  IF v_tenant_id IS NULL THEN
    SELECT utm.tenant_id INTO v_tenant_id
    FROM public.user_tenant_memberships utm
    JOIN public.tenants t
      ON t.id = utm.tenant_id
     AND t.suspended_at IS NULL
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
  claims := jsonb_set(claims, '{app_role}',  to_jsonb(COALESCE(v_app_role, 'employee')));

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
