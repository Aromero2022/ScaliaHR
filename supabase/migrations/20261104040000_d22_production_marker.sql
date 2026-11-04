-- D22 — Production marker for db-remote-sync
--
-- A database that has been synced as production says so itself: the
-- production mode of db-remote-sync inserts the single row of this table, and
-- scripts/lib/db-sync-guard.sh refuses reset and repair-push on any database
-- that has it, whatever target the run was given. Migrations only create the
-- table; the row is never part of a migration or of the seed.

CREATE SCHEMA ops;
REVOKE ALL ON SCHEMA ops FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE ops.production_marker (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  marked_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ops.production_marker IS
  'One row on production databases only, written by db-remote-sync (D22). Blocks reset and repair-push.';

REVOKE ALL ON ops.production_marker FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE ops.production_marker ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.production_marker FORCE ROW LEVEL SECURITY;
-- Only the migration owner, which is the role db-remote-sync connects with.
CREATE POLICY migration_owner_all ON ops.production_marker
  FOR ALL TO postgres USING (true) WITH CHECK (true);
