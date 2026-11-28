-- D57: public.users.email is stored in one form, lower(btrim(email)), so a
-- person's account never depends on how their email was typed. The key between
-- Scalia apps is auth_uid (docs/ARCHITECTURE.md, D57); the email is only
-- informative, and in public.users it is unique per tenant.
--
--   1. Stops, without changing anything, when normalizing would give two users
--      of one tenant the same email. It never merges or deletes: those rows
--      are resolved by hand first. The message names tenants and user ids,
--      never the emails (D27, D53).
--   2. Normalizes the rows that are not.
--   3. anonymize_user() writes its placeholder email in lower case. Its token
--      keeps its upper case in first_name and in ec_personal_information.
--   4. CHECK (email = lower(btrim(email))). UNIQUE (tenant_id, email) stays.
--
-- D22: narrowing a constraint is a contract step. It is safe in one release
-- here because no write path of the running or previous image produces
-- another form: GoTrue stores emails in lower case (email-normalized.test.ts),
-- create-tenant copies that value, and anonymize_user() changes in this same migration,
-- before the CHECK exists. scripts/link-owner.sh and create-tenant.ts also
-- normalize from this release on. There is no trigger on auth.users.

-- 1. Emails that would collide within a tenant.
DO $$
DECLARE
  v_collisions text;
BEGIN
  SELECT string_agg(format('tenant %s: users %s', d.tenant_id, d.ids), '; ' ORDER BY d.tenant_id, d.ids)
    INTO v_collisions
  FROM (
    SELECT u.tenant_id, string_agg(u.id::text, ', ' ORDER BY u.id) AS ids
    FROM public.users u
    GROUP BY u.tenant_id, lower(btrim(u.email))
    HAVING count(*) > 1
  ) d;

  IF v_collisions IS NOT NULL THEN
    RAISE EXCEPTION 'D57: some users of a tenant have emails that differ only in case or surrounding spaces. Nothing was changed, merged or deleted; resolve them by hand and run the migration again. %', v_collisions;
  END IF;
END $$;

-- 2. Normalize.
UPDATE public.users
SET email = lower(btrim(email))
WHERE email <> lower(btrim(email));

-- 3. anonymize_user(): the same function as 20261027080000, with the
--    placeholder email in lower case. CREATE OR REPLACE keeps its owner and
--    its grants (EXECUTE for authenticated and prisma_app, none for anon).
CREATE OR REPLACE FUNCTION public.anonymize_user(p_user_id uuid, p_arco_request_id uuid)
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
    -- D57: emails are stored in lower case; the token keeps its case in the names.
    email         = lower(v_token) || '@removed.local',
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

-- 4. One form from now on.
ALTER TABLE public.users
  ADD CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email)));
