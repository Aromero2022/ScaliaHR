-- D25 — Database hardening (Phase 9b, PR 1)
--
-- 1. App roles lose the table privileges that bypass RLS or act like DDL:
--    TRUNCATE (empties a table ignoring RLS), TRIGGER (attaches code to other
--    users' writes), REFERENCES (lets foreign keys pin rows) and MAINTAIN
--    (PostgreSQL 17: LOCK TABLE, VACUUM, REINDEX…). They come from Supabase's
--    default grants and the app never uses them. prisma_app had them through
--    its membership in authenticated.
-- 2. Supabase advisors at zero: pg-boss functions get a fixed search_path, the
--    pg-boss foreign keys get covering indexes and rate_limits states its
--    deny-all intent with a policy.

-- ─── 1. Privileges ──────────────────────────────────────────────────────────
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated, prisma_app;

-- Tables created by later migrations (owner postgres) start without them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLES FROM anon, authenticated;

-- ─── 2a. pg-boss functions: fixed search_path ───────────────────────────────
-- Every name in their bodies is schema-qualified and built-ins resolve through
-- pg_catalog, so an empty search_path changes nothing but closes the advisor
-- finding (D17 left it pending). A pg-boss upgrade that recreates them must
-- repeat this; the advisors check in CI fails until it does.
ALTER FUNCTION pgboss.job_now() SET search_path = '';
ALTER FUNCTION pgboss.job_table_format(text, text) SET search_path = '';
ALTER FUNCTION pgboss.job_table_run(text, text, text) SET search_path = '';
ALTER FUNCTION pgboss.job_table_run_async(text, integer, text, text, text) SET search_path = '';
ALTER FUNCTION pgboss.create_queue(text, jsonb) SET search_path = '';
ALTER FUNCTION pgboss.delete_queue(text) SET search_path = '';

-- ─── 2b. pg-boss foreign keys: covering indexes ─────────────────────────────
-- d25_ prefix: pg-boss names its own indexes job_iN.
CREATE INDEX d25_job_common_dead_letter ON pgboss.job_common (dead_letter);
CREATE INDEX d25_queue_dead_letter ON pgboss.queue (dead_letter);
CREATE INDEX d25_subscription_name ON pgboss.subscription (name);

-- ─── 2c. rate_limits: only through check_rate_limit() ───────────────────────
-- RLS already hides every row; a RESTRICTIVE block makes that intent explicit
-- (no permissive policy can ever open it) and the revoke removes direct table
-- access, which nothing uses.
REVOKE ALL ON public.rate_limits FROM anon, authenticated, prisma_app;
CREATE POLICY rate_limits_no_direct_access ON public.rate_limits
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
