-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Normalize app_role: eliminate 'admin' and 'member', add CHECK     ║
-- ║  Canonical values: owner, hr_admin, manager, employee              ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- 1. Migrate stale values → canonical
UPDATE public.user_tenant_memberships SET app_role = 'owner'    WHERE app_role = 'admin';
UPDATE public.user_tenant_memberships SET app_role = 'employee' WHERE app_role = 'member';

-- 2. Change the column default from 'member' to 'employee'
ALTER TABLE public.user_tenant_memberships
  ALTER COLUMN app_role SET DEFAULT 'employee';

-- 3. Add CHECK constraint so only canonical values are accepted
ALTER TABLE public.user_tenant_memberships
  ADD CONSTRAINT app_role_allowed
  CHECK (app_role IN ('owner', 'hr_admin', 'manager', 'employee'));

-- 4. Update custom_access_token_hook: COALESCE fallback → 'employee'
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
  claims := jsonb_set(claims, '{app_role}',  to_jsonb(COALESCE(v_app_role, 'employee')));

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- 5. Fix demo seed data (originally seeded in 20261023030100_auth_tenant_claims)
UPDATE public.user_tenant_memberships
  SET app_role = 'owner'
  WHERE user_id = 'f0000000-0000-0000-0000-000000000001'
    AND tenant_id = 'a0000000-0000-0000-0000-000000000001'
    AND app_role != 'owner';
