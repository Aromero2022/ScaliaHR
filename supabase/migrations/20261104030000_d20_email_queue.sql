-- D20 — Transactional email through the worker queue
--
-- The web server enqueues jobs on email.send with its own role, email_enqueuer;
-- the worker (worker_app, D17) renders them with packages/email and delivers
-- them through the SMTP adapter (Mailpit locally, Resend in Phase 23).
-- As in D17, the queue is declared here and nobody runs DDL at runtime.

-- ─── Queue ──────────────────────────────────────────────────────────────────
-- Five retries with exponential backoff from 30 s, then system.dead_letter.
-- Finished jobs (and the addresses in them) are deleted after one day.
SELECT pgboss.create_queue(
  'email.send',
  '{"policy":"standard","retryLimit":5,"retryDelay":30,"retryBackoff":true,"deadLetter":"system.dead_letter","deleteAfterSeconds":86400}'::jsonb
);

-- ─── email_enqueuer: the role the web server enqueues with ──────────────────
-- Password is set out of band: scripts/local-up.sh locally, a secret remotely.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'email_enqueuer') THEN
    CREATE ROLE email_enqueuer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM email_enqueuer;

-- What pg-boss send() needs and nothing else: read the schema version and the
-- queue options, insert into the shared job table and read back the new id.
-- It cannot read job data, update or delete jobs, or touch any other table.
GRANT USAGE ON SCHEMA pgboss TO email_enqueuer;
GRANT SELECT ON pgboss.version, pgboss.queue TO email_enqueuer;
GRANT INSERT ON pgboss.job_common TO email_enqueuer;
GRANT SELECT (id, name, start_after) ON pgboss.job_common TO email_enqueuer;
GRANT EXECUTE ON FUNCTION pgboss.job_now() TO email_enqueuer;

CREATE POLICY email_enqueuer_read ON pgboss.version FOR SELECT TO email_enqueuer USING (true);
CREATE POLICY email_enqueuer_read ON pgboss.queue FOR SELECT TO email_enqueuer USING (name = 'email.send');
CREATE POLICY email_enqueuer_insert ON pgboss.job_common FOR INSERT TO email_enqueuer
  WITH CHECK (name = 'email.send');
-- INSERT ... RETURNING id needs a SELECT policy; the column grant above keeps
-- the payload (addresses and links) out of reach.
CREATE POLICY email_enqueuer_returning ON pgboss.job_common FOR SELECT TO email_enqueuer
  USING (name = 'email.send');

-- ─── Branding lookup for the worker ─────────────────────────────────────────
-- worker_app has no access to public tables. This function returns only what
-- an email needs, and no row when the tenant does not exist or is suspended
-- (D21), in which case the worker drops the email.
-- Branding comes from system_configurations key 'company.branding'
-- ({"logoUrl": "https://…", "primaryColor": "#RRGGBB"}); packages/email
-- validates both values and falls back to the ScaliaHR brand.
CREATE FUNCTION public.email_branding(p_tenant_id uuid)
RETURNS TABLE (tenant_name text, logo_url text, primary_color text, locale text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.name,
         b.value_json ->> 'logoUrl',
         b.value_json ->> 'primaryColor',
         l.value_json #>> '{}'
  FROM public.tenants t
  LEFT JOIN public.system_configurations b ON b.tenant_id = t.id AND b.key = 'company.branding'
  LEFT JOIN public.system_configurations l ON l.tenant_id = t.id AND l.key = 'platform.locale'
  WHERE t.id = p_tenant_id
    AND t.suspended_at IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.email_branding(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO worker_app;
GRANT EXECUTE ON FUNCTION public.email_branding(uuid) TO worker_app;
