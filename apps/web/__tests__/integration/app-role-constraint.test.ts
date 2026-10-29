import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { integrationEnv } from "./helpers/env";
import { TestWorld, claimsOf } from "./helpers/world";

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();

const world = new TestWorld(env, db);

afterAll(async () => {
  await world.cleanup();
  await db.end();
});

describe("app_role CHECK constraint", () => {
  it("rejects an app_role value outside the allowed list", async () => {
    const tenant = await world.createTenant();
    const { authId } = await world.createAuthUser();

    await expect(
      db.query(
        `INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role, is_active)
         VALUES ($1, $2, 'superadmin', true)`,
        [authId, tenant.id],
      ),
    ).rejects.toThrow(/app_role_allowed/);
  });

  it("accepts all four canonical app_role values", async () => {
    const tenant = await world.createTenant();

    for (const role of ["owner", "hr_admin", "manager", "employee"] as const) {
      const { authId } = await world.createAuthUser();
      await db.query(
        `INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role, is_active)
         VALUES ($1, $2, $3, true)`,
        [authId, tenant.id, role],
      );
    }
  });

  it("rejects the legacy 'admin' value", async () => {
    const tenant = await world.createTenant();
    const { authId } = await world.createAuthUser();

    await expect(
      db.query(
        `INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role, is_active)
         VALUES ($1, $2, 'admin', true)`,
        [authId, tenant.id],
      ),
    ).rejects.toThrow(/app_role_allowed/);
  });

  it("rejects the legacy 'member' value", async () => {
    const tenant = await world.createTenant();
    const { authId } = await world.createAuthUser();

    await expect(
      db.query(
        `INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role, is_active)
         VALUES ($1, $2, 'member', true)`,
        [authId, tenant.id],
      ),
    ).rejects.toThrow(/app_role_allowed/);
  });
});

describe("custom_access_token_hook fallback", () => {
  it("emits app_role 'employee' when user has no membership", async () => {
    const user = await world.userWithoutTenant();

    const claims = claimsOf(user.token);
    expect(claims.app_role).toBe("employee");
  });

  it("emits empty tenant_id when user has no membership", async () => {
    const user = await world.userWithoutTenant();

    const claims = claimsOf(user.token);
    expect(claims.tenant_id).toBe("");
  });
});
