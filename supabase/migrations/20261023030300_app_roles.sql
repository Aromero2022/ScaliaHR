-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  D3 — Application Database Roles                                   ║
-- ║  prisma_app: LOGIN, NOBYPASSRLS, inherits authenticated.          ║
-- ║  Password from env var PRISMA_APP_PASSWORD at deploy time.         ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- Create the prisma_app role if it doesn't exist.
-- Password is set ONLY by the db-remote-sync workflow from PRISMA_APP_PASSWORD secret.
-- Never set or change the password manually.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prisma_app') THEN
    CREATE ROLE prisma_app LOGIN NOBYPASSRLS;
  END IF;
END $$;

-- prisma_app inherits the authenticated role so RLS policies
-- that target TO authenticated apply to it.
GRANT authenticated TO prisma_app;

-- Grant schema usage and table access
GRANT USAGE ON SCHEMA public TO prisma_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO prisma_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO prisma_app;

-- Grant sequence usage for id generation
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO prisma_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO prisma_app;

-- Grant execute on tenant helper functions
GRANT EXECUTE ON FUNCTION public.requesting_tenant_id() TO prisma_app;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO prisma_app;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin() TO prisma_app;
