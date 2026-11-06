import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";
import { MODULE_FLAG_KEYS } from "@/lib/tenant/module-flags";

/**
 * D35: the per-tenant module flags cache is filled through
 * public.tenant_module_flags(), which only the server's prisma_app runs.
 * D38: the employee list has its ordering index.
 */

const env = integrationEnv();
const prismaAppUrl = process.env.PRISMA_APP_TEST_DB_URL;
if (!prismaAppUrl) throw new Error("PRISMA_APP_TEST_DB_URL is not set: source scripts/supabase-test-env.sh");

const db = new pg.Client({ connectionString: env.dbUrl });
const app = new pg.Client({ connectionString: prismaAppUrl });
await db.connect();
await app.connect();
const world = new TestWorld(env, db);
let tenant: TestTenant;

beforeAll(async () => {
  tenant = await world.createTenant();
  await db.query("UPDATE public.tenants SET is_lms_active = false, is_tih_active = true WHERE id = $1", [tenant.id]);
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await app.end();
    await db.end();
  }
});

describe("tenant_module_flags (D35)", () => {
  it("gives prisma_app exactly the module flags of one tenant", async () => {
    const { rows, fields } = await app.query("SELECT * FROM public.tenant_module_flags($1)", [tenant.id]);
    expect(fields.map((f) => f.name).sort()).toEqual([...MODULE_FLAG_KEYS].sort());
    const { rows: expected } = await db.query(`SELECT ${MODULE_FLAG_KEYS.join(", ")} FROM public.tenants WHERE id = $1`, [tenant.id]);
    expect(rows).toEqual(expected);
    expect(rows[0]).toMatchObject({ is_lms_active: false, is_tih_active: true });
  });

  it("returns no row for an unknown tenant", async () => {
    const { rows } = await app.query("SELECT * FROM public.tenant_module_flags($1)", ["00000000-0000-0000-0000-00000000d35a"]);
    expect(rows).toEqual([]);
  });

  it("cannot be called from the Data API, signed in or not", async () => {
    const anon = createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false } });
    for (const client of [anon, tenant.employee.client, tenant.admin.client]) {
      const { error } = await client.rpc("tenant_module_flags", { p_tenant_id: tenant.id });
      expect(error?.code).toBe("42501");
    }
  });
});

describe("employee list index (D38)", () => {
  it("orders active, not deleted employees by tenant and name", async () => {
    const { rows } = await db.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'd38_users_active_by_name'",
    );
    expect(rows[0]?.indexdef).toMatch(/ON public\.users USING btree \(tenant_id, last_name, first_name\) WHERE \(\(deleted_at IS NULL\) AND \(status = 'ACTIVE'::"EmployeeStatus"\)\)/);
  });
});
