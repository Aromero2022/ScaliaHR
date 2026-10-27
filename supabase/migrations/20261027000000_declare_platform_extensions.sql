-- Declare the platform extensions present on the hosted project and in the
-- CLI shadow database, so `supabase db diff` between repo and any target is
-- empty instead of reporting them as drift.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS hypopg WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS index_advisor WITH SCHEMA extensions;
