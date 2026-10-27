import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant, type TestUser } from "./helpers/world";

/**
 * S1 Security Hardening Integration Tests
 *
 * - requesting_tenant_id() is JWT-only (no fallback)
 * - current_tenant_id() has been dropped
 * - PII RESTRICTIVE policies on ec_personal_information / ec_compensation
 * - ARCO requests visible to their subject only (and admins), closed to anon
 * - RBP v2 (role_grants + group_members) drives is_tenant_admin()
 * - v1 artefacts dropped (role_assignments)
 *
 * Every fixture is created by this suite with real auth users; no demo data.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

let tenant: TestTenant;
let otherTenant: TestTenant;
let noTenantUser: Omit<TestUser, "userId">;

async function addPiiRows(t: TestTenant, user: TestUser) {
  await db.query(
    `INSERT INTO public.ec_compensation (tenant_id, user_id, start_date, base_salary)
     VALUES ($1, $2, DATE '2026-01-01', 1000)`,
    [t.id, user.userId],
  );
  await db.query(
    `INSERT INTO public.ec_personal_information (tenant_id, user_id, start_date, first_name, last_name)
     VALUES ($1, $2, DATE '2026-01-01', 'Pii', 'Fixture')`,
    [t.id, user.userId],
  );
}

beforeAll(async () => {
  tenant = await world.createTenant();
  otherTenant = await world.createTenant();
  noTenantUser = await world.userWithoutTenant();
  for (const user of [tenant.admin, tenant.manager, tenant.employee]) {
    await addPiiRows(tenant, user);
  }
  await db.query(
    `INSERT INTO public.arco_requests (tenant_id, requester_id, subject_id, request_type, description, due_date)
     VALUES ($1, $2, $2, 'acceso', 'Integration fixture', DATE '2026-12-31')`,
    [tenant.id, tenant.employee.userId],
  );
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

describe("requesting_tenant_id() — JWT-only", () => {
  it("returns the tenant of a signed-in user", async () => {
    const { data, error } = await tenant.employee.client.rpc("requesting_tenant_id");
    expect(error).toBeNull();
    expect(data).toBe(tenant.id);
  });

  it("returns null for a signed-in user without tenant", async () => {
    const { data, error } = await noTenantUser.client.rpc("requesting_tenant_id");
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe("current_tenant_id() dropped", () => {
  it("RPC call fails because function does not exist", async () => {
    const { error } = await world.svc.rpc("current_tenant_id");
    expect(error).toBeTruthy();
  });
});

describe("PII RESTRICTIVE policies", () => {
  it("an employee sees only their own ec_compensation rows", async () => {
    const { data, error } = await tenant.employee.client.from("ec_compensation").select("user_id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.user_id)).toEqual([tenant.employee.userId]);
  });

  it("an employee sees only their own ec_personal_information rows", async () => {
    const { data, error } = await tenant.employee.client
      .from("ec_personal_information")
      .select("user_id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.user_id)).toEqual([tenant.employee.userId]);
  });

  it("a manager sees own and direct-report compensation, not peers'", async () => {
    const { data, error } = await tenant.manager.client.from("ec_compensation").select("user_id");
    expect(error).toBeNull();
    expect(new Set((data ?? []).map((r) => r.user_id))).toEqual(
      new Set([tenant.manager.userId, tenant.employee.userId]),
    );
  });

  it("a tenant admin sees every compensation row of the tenant only", async () => {
    const { data, error } = await tenant.admin.client
      .from("ec_compensation")
      .select("user_id, tenant_id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(3);
    for (const row of data ?? []) expect(row.tenant_id).toBe(tenant.id);
  });

  it("anon cannot read ec_personal_information", async () => {
    const { data, error } = await world.anon.from("ec_personal_information").select("user_id").limit(1);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("anon cannot read ec_compensation", async () => {
    const { data, error } = await world.anon.from("ec_compensation").select("user_id").limit(1);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});

describe("ARCO policies — role-based access", () => {
  it("anon cannot read arco_requests", async () => {
    const { data, error } = await world.anon.from("arco_requests").select("id").limit(1);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("the subject sees their own request and a peer does not", async () => {
    const own = await tenant.employee.client.from("arco_requests").select("subject_id");
    expect(own.error).toBeNull();
    expect((own.data ?? []).map((r) => r.subject_id)).toEqual([tenant.employee.userId]);

    const peer = await tenant.manager.client.from("arco_requests").select("id");
    expect(peer.error).toBeNull();
    expect(peer.data).toEqual([]);
  });
});

describe("RBP v2 model", () => {
  it("role_grants and group_members are readable by service_role", async () => {
    const grants = await world.svc.from("role_grants").select("id").eq("tenant_id", tenant.id);
    const members = await world.svc.from("group_members").select("id").eq("tenant_id", tenant.id);
    expect(grants.error).toBeNull();
    expect(members.error).toBeNull();
    expect(grants.data!.length).toBe(2);
    expect(members.data!.length).toBe(3);
  });

  it("an is_admin_role grant to a group makes its members tenant admins", async () => {
    const { data, error } = await tenant.admin.client.rpc("is_tenant_admin");
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it("members of a group granted only a non-admin role are not tenant admins", async () => {
    for (const user of [tenant.manager, tenant.employee]) {
      const { data, error } = await user.client.rpc("is_tenant_admin");
      expect(error).toBeNull();
      expect(data).toBe(false);
    }
  });

  it("users read the role grants of their own tenant only", async () => {
    const { data, error } = await tenant.employee.client
      .from("role_grants")
      .select("tenant_id, target_population");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(row.tenant_id).toBe(tenant.id);
      expect(["all", "self", "direct_reports", "same_department"]).toContain(row.target_population);
    }
  });

  it("a user cannot be added to another tenant's admin group", async () => {
    await expect(
      db.query("INSERT INTO public.group_members (tenant_id, group_id, user_id) VALUES ($1, $2, $3)", [
        otherTenant.id,
        otherTenant.adminGroupId,
        tenant.employee.userId,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
    const { data, error } = await tenant.employee.client.rpc("is_tenant_admin");
    expect(error).toBeNull();
    expect(data).toBe(false);
  });
});

describe("v1 artefacts dropped", () => {
  it("role_assignments table no longer exists", async () => {
    const { error } = await world.svc.from("role_assignments").select("id").limit(1);
    expect(error).toBeTruthy();
  });
});
