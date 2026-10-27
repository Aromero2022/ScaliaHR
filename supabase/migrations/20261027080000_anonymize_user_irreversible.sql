-- anonymize_user() becomes the final, irreversible suppression step of an ARCO
-- cancellation:
--   * no re-identification map: nothing original is returned or logged;
--   * audit_logs gets only the event (actor, time, user id, ARCO request id);
--   * every personal column of ec_personal_information is cleared;
--   * personal values already present in the tenant's audit_logs are replaced
--     with '[suprimido]' (rows are kept);
--   * ids, employee_id, auth_uid and the reporting line are kept.
-- It now requires the cancelacion request it executes.

-- Replaces every JSON string that contains one of the needles.
CREATE OR REPLACE FUNCTION public.scrub_personal_data(p_doc jsonb, p_needles text[])
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_out jsonb;
  v_key text;
  v_val jsonb;
BEGIN
  IF p_doc IS NULL OR p_needles IS NULL THEN
    RETURN p_doc;
  END IF;

  CASE jsonb_typeof(p_doc)
    WHEN 'object' THEN
      v_out := '{}'::jsonb;
      FOR v_key, v_val IN SELECT e.key, e.value FROM jsonb_each(p_doc) e LOOP
        v_out := v_out || jsonb_build_object(v_key, public.scrub_personal_data(v_val, p_needles));
      END LOOP;
      RETURN v_out;
    WHEN 'array' THEN
      SELECT coalesce(jsonb_agg(public.scrub_personal_data(a.elem, p_needles) ORDER BY a.ord), '[]'::jsonb)
        INTO v_out
        FROM jsonb_array_elements(p_doc) WITH ORDINALITY a(elem, ord);
      RETURN v_out;
    WHEN 'string' THEN
      IF EXISTS (
        SELECT 1 FROM unnest(p_needles) n
        WHERE position(lower(n) IN lower(p_doc #>> '{}')) > 0
      ) THEN
        RETURN to_jsonb('[suprimido]'::text);
      END IF;
      RETURN p_doc;
    ELSE
      RETURN p_doc;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.scrub_personal_data(jsonb, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scrub_personal_data(jsonb, text[]) FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.anonymize_user(uuid);

CREATE FUNCTION public.anonymize_user(p_user_id uuid, p_arco_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_actor_id  uuid;
  v_user      record;
  v_request   record;
  v_needles   text[];
  v_token     text;
  v_now       timestamptz := now();
BEGIN
  SELECT u.id, u.tenant_id INTO v_actor_id, v_tenant_id
  FROM public.users u
  WHERE u.auth_uid = auth.uid()
    AND u.tenant_id = public.requesting_tenant_id()
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

  IF v_user.is_anonymized THEN
    RAISE EXCEPTION 'User already anonymized: %', p_user_id;
  END IF;

  SELECT * INTO v_request
  FROM public.arco_requests
  WHERE id = p_arco_request_id AND tenant_id = v_tenant_id;

  IF NOT FOUND
     OR v_request.request_type <> 'cancelacion'
     OR v_request.subject_id <> p_user_id THEN
    RAISE EXCEPTION 'A cancelacion ARCO request for this user is required';
  END IF;

  IF v_request.status NOT IN ('pending', 'in_progress') THEN
    RAISE EXCEPTION 'ARCO request already processed: %', p_arco_request_id;
  END IF;

  -- Original personal values, used only to scrub earlier audit entries.
  SELECT array_agg(DISTINCT v) INTO v_needles
  FROM (
    SELECT unnest(ARRAY[v_user.first_name, v_user.last_name, v_user.email]) AS v
    UNION ALL
    SELECT unnest(ARRAY[
      pi.first_name, pi.last_name, pi.middle_name, pi.phone, pi.personal_email,
      pi.national_id, pi.tax_id, pi.address_line1, pi.address_line2,
      pi.emergency_contact_name, pi.emergency_contact_phone, pi.date_of_birth::text
    ])
    FROM public.ec_personal_information pi
    WHERE pi.user_id = p_user_id AND pi.tenant_id = v_tenant_id
  ) s
  WHERE v IS NOT NULL AND length(v) >= 3;

  -- Random, not derived from the user: cannot be linked back.
  v_token := 'ANON-' || substr(md5(gen_random_uuid()::text), 1, 8);

  UPDATE public.users SET
    first_name    = v_token,
    last_name     = 'ANONIMIZADO',
    email         = v_token || '@removed.local',
    is_anonymized = true,
    deleted_at    = v_now,
    status        = 'TERMINATED',
    updated_at    = v_now
  WHERE id = p_user_id AND tenant_id = v_tenant_id;

  UPDATE public.ec_personal_information SET
    first_name              = v_token,
    last_name               = 'ANONIMIZADO',
    middle_name             = NULL,
    date_of_birth           = NULL,
    gender                  = NULL,
    marital_status          = NULL,
    nationality             = NULL,
    national_id             = NULL,
    tax_id                  = NULL,
    phone                   = NULL,
    personal_email          = NULL,
    address_line1           = NULL,
    address_line2           = NULL,
    city                    = NULL,
    state                   = NULL,
    postal_code             = NULL,
    country                 = NULL,
    emergency_contact_name  = NULL,
    emergency_contact_phone = NULL,
    event_reason            = NULL,
    updated_at              = v_now
  WHERE user_id = p_user_id AND tenant_id = v_tenant_id;

  IF v_needles IS NOT NULL THEN
    UPDATE public.audit_logs al SET
      diff         = public.scrub_personal_data(al.diff, v_needles),
      details_json = public.scrub_personal_data(al.details_json, v_needles)
    WHERE al.tenant_id = v_tenant_id
      AND EXISTS (
        SELECT 1 FROM unnest(v_needles) n
        WHERE position(lower(n) IN lower(coalesce(al.diff::text, '') || coalesce(al.details_json::text, ''))) > 0
      );
  END IF;

  PERFORM public.write_audit_log(
    v_tenant_id,
    v_actor_id,
    'arco.anonymize',
    'users',
    p_user_id::text,
    jsonb_build_object('arco_request_id', p_arco_request_id)
  );

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'arco_request_id', p_arco_request_id,
    'anonymized_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_user(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.anonymize_user(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.anonymize_user(uuid, uuid) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prisma_app') THEN
    GRANT EXECUTE ON FUNCTION public.anonymize_user(uuid, uuid) TO prisma_app;
  END IF;
END $$;

-- Re-identification maps written by earlier versions.
UPDATE public.audit_logs
SET diff = diff - 'original_first_name' - 'original_last_name' - 'original_email'
WHERE action = 'arco.anonymize'
  AND diff ?| ARRAY['original_first_name', 'original_last_name', 'original_email'];
