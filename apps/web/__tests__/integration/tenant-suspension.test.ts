import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { claimsOf, TestWorld, type TestTenant } from "./helpers/world";

/**
 * D21 — a suspended tenant keeps its data, but new tokens stop carrying it, so
 * RLS hides its rows; only the platform can suspend.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

let tenant: TestTenant;
let other: TestTenant;

beforeAll(async () => {
  tenant = await world.createTenant();
  other = await world.createTenant();
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

async function suspend(id: string, suspended: boolean) {
  await db.query("UPDATE public.tenants SET suspended_at = CASE WHEN $2 THEN now() END WHERE id = $1", [id, suspended]);
}

describe("tenant suspension (D21)", () => {
  it("cannot be set or cleared by the tenant's own owner", async () => {
    const { error } = await tenant.admin.client
      .from("tenants")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", tenant.id);
    expect(error?.code).toBe("42501");
    const { rows } = await db.query("SELECT suspended_at FROM public.tenants WHERE id = $1", [tenant.id]);
    expect(rows[0].suspended_at).toBeNull();
  });

  it("drops the tenant from new tokens, so RLS hides its rows", async () => {
    await suspend(tenant.id, true);
    try {
      const token = await world.signIn(tenant.employee.email);
      expect(claimsOf(token).tenant_id).toBe("");
      const client = world.clientFor(token);
      const tenants = await client.from("tenants").select("id");
      const users = await client.from("users").select("id");
      expect(tenants.data).toEqual([]);
      expect(users.data).toEqual([]);
    } finally {
      await suspend(tenant.id, false);
    }
    expect(claimsOf(await world.signIn(tenant.employee.email)).tenant_id).toBe(tenant.id);
  });

  it("falls back to another active membership when the active tenant is suspended", async () => {
    await db.query(
      `INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role, is_active)
       VALUES ($1, $2, 'employee', true)`,
      [tenant.manager.authId, other.id],
    );
    await suspend(tenant.id, true);
    try {
      const claims = claimsOf(await world.signIn(tenant.manager.email));
      expect(claims.tenant_id).toBe(other.id);
      expect(claims.app_role).toBe("employee");
    } finally {
      await suspend(tenant.id, false);
    }
  });
});
