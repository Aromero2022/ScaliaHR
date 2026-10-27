-- anonymize_user() cleared ec_personal_information.imss_number, a column that
-- does not exist: the UPDATE raised 42703 for any user with personal
-- information, so ARCO cancellation always failed. The real schema keeps the
-- official identifiers in national_id and tax_id, which are already cleared.

CREATE OR REPLACE FUNCTION public.anonymize_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_actor_id  uuid;
  v_token     text;
  v_map       jsonb := '{}'::jsonb;
  v_user      record;
  v_pi        record;
BEGIN
  SELECT u.id, u.tenant_id INTO v_actor_id, v_tenant_id
  FROM public.users u
  WHERE u.auth_uid = auth.uid()
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Caller not found';
  END IF;

  IF NOT public.is_tenant_admin() THEN
    RAISE EXCEPTION 'Only tenant admins can anonymize users';
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE id = p_user_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found in tenant: %', p_user_id;
  END IF;

  v_token := 'ANON-' || substr(md5(p_user_id::text || now()::text), 1, 8);

  v_map := jsonb_build_object(
    'original_first_name', v_user.first_name,
    'original_last_name',  v_user.last_name,
    'original_email',      v_user.email,
    'token', v_token
  );

  UPDATE public.users SET
    first_name    = v_token,
    last_name     = 'ANONIMIZADO',
    email         = v_token || '@removed.local',
    is_anonymized = true,
    deleted_at    = now(),
    status        = 'TERMINATED',
    updated_at    = now()
  WHERE id = p_user_id AND tenant_id = v_tenant_id;

  FOR v_pi IN SELECT id FROM public.ec_personal_information WHERE user_id = p_user_id AND tenant_id = v_tenant_id LOOP
    UPDATE public.ec_personal_information SET
      first_name              = v_token,
      last_name               = 'ANONIMIZADO',
      middle_name             = NULL,
      phone                   = NULL,
      personal_email          = NULL,
      national_id             = NULL,
      tax_id                  = NULL,
      address_line1           = NULL,
      address_line2           = NULL,
      city                    = NULL,
      state                   = NULL,
      postal_code             = NULL,
      emergency_contact_name  = NULL,
      emergency_contact_phone = NULL
    WHERE id = v_pi.id;
  END LOOP;

  PERFORM public.write_audit_log(
    v_tenant_id,
    v_actor_id,
    'arco.anonymize',
    'users',
    p_user_id::text,
    v_map
  );

  RETURN v_map;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_user(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.anonymize_user(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.anonymize_user(uuid) TO authenticated;
