-- Declare the platform extensions present on the hosted project so that
-- `supabase db diff` between repo and any target does not report them.
-- pg_net is intentionally absent: see supabase/drift-allowlist.txt and
-- docs/ARCHITECTURE.md (D8).
CREATE EXTENSION IF NOT EXISTS hypopg WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS index_advisor WITH SCHEMA extensions;
