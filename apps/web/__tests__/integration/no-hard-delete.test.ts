import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

/**
 * D46 — soft delete only: anon and authenticated never remove rows. Read from
 * the catalog, so a later migration that brings DELETE back fails here:
 * - no relation of public grants them DELETE (directly or through PUBLIC);
 * - no PERMISSIVE DELETE or ALL policy applies to them (RESTRICTIVE ones only
 *   ever take rows away, so the `false` locks may stay);
 * - the default privileges of postgres (the owner of our migrations) do not
 *   give DELETE to new relations of public.
 * supabase_admin's own default privileges still grant DELETE; they apply only
 * to relations supabase_admin creates, which the first check covers anyway.
 */

const FINDINGS = `
  SELECT 'privilege' AS kind, format('%I.%I', n.nspname, c.relname) AS relation, r.role AS detail
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND has_table_privilege(r.role, c.oid, 'DELETE')
  UNION ALL
  SELECT 'policy', format('%I.%I', schemaname, tablename), policyname
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd IN ('DELETE', 'ALL')
    AND permissive = 'PERMISSIVE'
    AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
  UNION ALL
  SELECT 'default privilege', coalesce(n.nspname, '(every schema)'), a.grantee::regrole::text
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE pg_get_userbyid(d.defaclrole) = 'postgres'
    AND (n.nspname = 'public' OR d.defaclnamespace = 0)
    AND d.defaclobjtype = 'r'
    AND a.privilege_type = 'DELETE'
    AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)
  ORDER BY 1, 2, 3`;

type Finding = { kind: string; relation: string; detail: string };

// The fifteen tables whose PERMISSIVE DELETE policy D46 removed.
const UNLOCKED_BEFORE_D46 = [
  "business_rules",
  "continuous_feedbacks",
  "departments",
  "job_classifications",
  "job_families",
  "job_informations",
  "job_roles",
  "object_definitions",
  "performance_goals",
  "positions",
  "succession_nominees",
  "succession_plans",
  "talent_pool_entries",
  "talent_pools",
  "users",
];

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);
let tenant: TestTenant;

beforeAll(async () => {
  tenant = await world.createTenant();
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

describe("no hard delete from the Data API (D46)", () => {
  it("the catalog gives anon and authenticated no way to delete in public", async () => {
    const { rows } = await db.query<Finding>(FINDINGS);
    expect(rows).toEqual([]);
  });

  it("negative control: a grant, a permissive policy and a default privilege added later are all reported", async () => {
    await db.query("BEGIN");
    try {
      await db.query("CREATE TABLE public.d46_probe (id int)");
      await db.query("ALTER TABLE public.d46_probe ENABLE ROW LEVEL SECURITY");
      await db.query("GRANT DELETE ON public.d46_probe TO authenticated");
      await db.query("CREATE POLICY d46_probe_delete ON public.d46_probe FOR DELETE USING (true)");
      await db.query("CREATE POLICY d46_probe_lock ON public.d46_probe AS RESTRICTIVE FOR DELETE TO authenticated USING (false)");
      await db.query("ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE ON TABLES TO anon");
      const { rows } = await db.query<Finding>(FINDINGS);
      // The RESTRICTIVE lock is not a finding: it can only take rows away.
      expect(rows).toEqual([
        { kind: "default privilege", relation: "public", detail: "anon" },
        { kind: "policy", relation: "public.d46_probe", detail: "d46_probe_delete" },
        { kind: "privilege", relation: "public.d46_probe", detail: "authenticated" },
      ]);
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("a relation created by a later migration starts without DELETE for them", async () => {
    await db.query("BEGIN");
    try {
      await db.query("CREATE TABLE public.d46_new (id int)");
      await db.query("CREATE VIEW public.d46_new_view AS SELECT id FROM public.d46_new");
      const { rows } = await db.query<{ relation: string; role: string; select: boolean; delete: boolean }>(
        `SELECT rel AS relation, r AS role,
                has_table_privilege(r, rel, 'SELECT') AS select,
                has_table_privilege(r, rel, 'DELETE') AS delete
         FROM unnest(ARRAY['public.d46_new', 'public.d46_new_view']) rel
         CROSS JOIN unnest(ARRAY['anon', 'authenticated']) r
         ORDER BY 1, 2`,
      );
      // Supabase's default SELECT still applies (RLS guards the rows); DELETE is gone.
      expect(rows.every((row) => row.select && !row.delete)).toBe(true);
      expect(rows).toHaveLength(4);
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("the RESTRICTIVE `false` locks stay as a second lock where the permissive policies were", async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies
       WHERE schemaname = 'public' AND cmd = 'DELETE' AND permissive = 'RESTRICTIVE'
         AND qual = 'false' AND roles && ARRAY['authenticated']::name[]
       ORDER BY 1`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(expect.arrayContaining(UNLOCKED_BEFORE_D46));
  });

  it("an admin's delete through the Data API is refused with 42501 and the row stays", async () => {
    const { rows: before } = await db.query("SELECT id FROM public.users WHERE id = $1", [tenant.employee.userId]);
    const { error } = await tenant.admin.client.from("users").delete().eq("id", tenant.employee.userId);
    expect(error?.code).toBe("42501");
    const { rows: after } = await db.query("SELECT id FROM public.users WHERE id = $1", [tenant.employee.userId]);
    expect(after).toEqual(before);
    expect(after).toHaveLength(1);
  });
});
