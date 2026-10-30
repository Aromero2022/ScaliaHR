import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

const env = integrationEnv();

// Prisma must use a non-BYPASSRLS role so RLS is actually enforced.
process.env.DATABASE_URL = env.prismaDbUrl;

const { can, clearCanCache } = await import("@/lib/authz/can");
const { prisma } = await import("@/lib/db/tenant-client");

// Setup client uses superuser to insert test fixtures (bypasses RLS intentionally).
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await world.createTenant();
});

beforeEach(() => {
  clearCanCache();
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
    await prisma.$disconnect();
  }
});

describe("Prisma connection does NOT have BYPASSRLS", () => {
  it("current_user has rolbypassrls = false", async () => {
    const [row] = await prisma.$queryRaw<{ cu: string; bypass: boolean }[]>`
      SELECT current_user AS cu, rolbypassrls AS bypass
      FROM pg_roles WHERE rolname = current_user`;
    expect(row.bypass).toBe(false);
  });
});

describe("real can() — admin gets admin_center.access and arco.manage", () => {
  it("admin has admin_center.access:view", async () => {
    const result = await can(
      tenant.admin.userId,
      tenant.id,
      "admin_center.access",
      "view",
    );
    expect(result).toEqual({ allowed: true });
  });

  it("admin has arco.manage:view", async () => {
    const result = await can(
      tenant.admin.userId,
      tenant.id,
      "arco.manage",
      "view",
    );
    expect(result).toEqual({ allowed: true });
  });
});

describe("real can() — employee lacks admin permissions", () => {
  it("employee does NOT have admin_center.access:view", async () => {
    const result = await can(
      tenant.employee.userId,
      tenant.id,
      "admin_center.access",
      "view",
    );
    expect(result.allowed).toBe(false);
  });

  it("employee does NOT have arco.manage:view", async () => {
    const result = await can(
      tenant.employee.userId,
      tenant.id,
      "arco.manage",
      "view",
    );
    expect(result.allowed).toBe(false);
  });
});

describe("real can() — manager lacks admin permissions", () => {
  it("manager does NOT have admin_center.access:view", async () => {
    const result = await can(
      tenant.manager.userId,
      tenant.id,
      "admin_center.access",
      "view",
    );
    expect(result.allowed).toBe(false);
  });

  it("manager does NOT have arco.manage:view", async () => {
    const result = await can(
      tenant.manager.userId,
      tenant.id,
      "arco.manage",
      "view",
    );
    expect(result.allowed).toBe(false);
  });
});

describe("real can() — reason field for denied access", () => {
  it("employee denied with reason no_permission or no_group_membership", async () => {
    const result = await can(
      tenant.employee.userId,
      tenant.id,
      "admin_center.access",
      "view",
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(["no_permission", "no_group_membership"]).toContain(result.reason);
  });
});

describe("real can() — link-owner on demo tenant", () => {
  const DEMO_TENANT = "a0000000-0000-0000-0000-000000000001";

  it("owner linked to demo tenant has admin_center.access and arco.manage", async () => {
    const { authId, email } = await world.createAuthUser();

    await db.query(
      `INSERT INTO public.users (auth_uid, tenant_id, email, first_name, last_name, status, hire_date, employee_id)
       SELECT $1::uuid, $2::uuid, $3, 'Test', 'Owner', 'ACTIVE', now(),
              'OWN-' || lpad(abs(('x' || left($1::text, 8))::bit(32)::int % 9999 + 1)::text, 4, '0')
       ON CONFLICT (auth_uid) DO NOTHING`,
      [authId, DEMO_TENANT, email],
    );

    await db.query(
      `INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role, is_active)
       VALUES ($1::uuid, $2::uuid, 'owner', true)
       ON CONFLICT (user_id, tenant_id) DO NOTHING`,
      [authId, DEMO_TENANT],
    );

    const { rows: userRows } = await db.query<{ id: string }>(
      "SELECT id FROM public.users WHERE auth_uid = $1::uuid LIMIT 1",
      [authId],
    );
    const userId = userRows[0].id;

    await db.query(
      `INSERT INTO public.group_members (tenant_id, group_id, user_id)
       SELECT rg.tenant_id, rg.granted_group_id, $2::uuid
       FROM public.role_grants rg
       JOIN public.permission_roles pr ON pr.id = rg.role_id AND pr.tenant_id = rg.tenant_id
       WHERE rg.tenant_id = $1::uuid AND lower(pr.name) = 'owner'
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [DEMO_TENANT, userId],
    );

    clearCanCache();
    const adminResult = await can(userId, DEMO_TENANT, "admin_center.access", "view");
    expect(adminResult).toEqual({ allowed: true });

    clearCanCache();
    const arcoResult = await can(userId, DEMO_TENANT, "arco.manage", "view");
    expect(arcoResult).toEqual({ allowed: true });
  });
});
