import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";

/**
 * Catalog checks mirroring the Supabase advisors we fixed, so they cannot
 * come back: mutable function search_path, extensions in public, per-row
 * evaluation of auth/tenant helpers in RLS policies, unindexed foreign keys.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
afterAll(() => db.end());

// Calls that must be wrapped in (SELECT ...) inside policies so the planner
// evaluates them once per statement instead of once per row.
const PER_ROW_CALL =
  /(?<!SELECT )\b(?:auth\.(?:uid|jwt|role|email)\(\)|(?:public\.)?(?:requesting_tenant_id|is_tenant_admin|current_app_user_id)\(\)|(?:public\.)?has_app_role\(|current_setting\()/;

describe("Supabase advisors", () => {
  it("every function in public has search_path fixed to ''", async () => {
    const { rows } = await db.query<{ fn: string; config: string[] | null }>(`
      SELECT p.oid::regprocedure::text AS fn, p.proconfig AS config
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
        AND NOT ('search_path=""' = ANY (coalesce(p.proconfig, '{}')))
      ORDER BY 1`);
    expect(rows.map((r) => `${r.fn} ${JSON.stringify(r.config)}`)).toEqual([]);
  });

  it("no extension is installed in schema public", async () => {
    const { rows } = await db.query<{ extname: string }>(
      "SELECT extname::text FROM pg_extension WHERE extnamespace = 'public'::regnamespace ORDER BY 1",
    );
    expect(rows.map((r) => r.extname)).toEqual([]);
  });

  it("RLS policies evaluate auth and tenant helpers once per statement", async () => {
    const { rows } = await db.query<{ policy: string; expr: string }>(`
      SELECT format('%s.%s', tablename, policyname) AS policy,
             coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expr
      FROM pg_policies WHERE schemaname = 'public' ORDER BY 1`);
    expect(rows.length).toBeGreaterThan(0);
    const offenders = rows.filter((r) => PER_ROW_CALL.test(r.expr)).map((r) => r.policy);
    expect(offenders).toEqual([]);
  });

  it("every foreign key in public is covered by an index", async () => {
    const { rows } = await db.query<{ fk: string }>(`
      SELECT format('%s.%s', con.conrelid::regclass, con.conname) AS fk
      FROM pg_constraint con
      WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = con.conrelid
            AND (i.indkey::int2[])[0:array_length(con.conkey, 1) - 1] = con.conkey
        )
      ORDER BY 1`);
    expect(rows.map((r) => r.fk)).toEqual([]);
  });
});
