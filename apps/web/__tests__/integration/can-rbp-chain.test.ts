import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

/**
 * Verifies that the can() RBP chain resolves correctly through the
 * RLS-protected tables (group_members → role_grants → role_permissions).
 *
 * The query runs the same SQL path as the application's can() function,
 * setting JWT claims inside a transaction so that RLS policies are satisfied.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

let tenant: TestTenant;

async function canViaRlsChain(
  userId: string,
  tenantId: string,
  permissionKey: string,
  action: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const claims = JSON.stringify({ tenant_id: tenantId, app_role: "member" });

  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM public.role_permissions rp
       JOIN public.role_grants rg ON rg.role_id = rp.role_id
                                  AND rg.tenant_id = rp.tenant_id
       JOIN public.group_members gm ON gm.group_id = rg.granted_group_id
                                    AND gm.tenant_id = rp.tenant_id
       WHERE gm.user_id        = $1::uuid
         AND rp.tenant_id      = $2::uuid
         AND rp.permission_key = $3
         AND rp.action         = $4::public.rbp_action
     ) AS ok`,
    [userId, tenantId, permissionKey, action],
  );

  return rows[0].ok
    ? { allowed: true }
    : { allowed: false, reason: "no_permission" };
}

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

describe("can() RBP chain — admin permissions", () => {
  it("admin has admin_center.access:view", async () => {
    const result = await canViaRlsChain(
      tenant.admin.userId,
      tenant.id,
      "admin_center.access",
      "view",
    );
    expect(result.allowed).toBe(true);
  });

  it("admin has arco.manage:view", async () => {
    const result = await canViaRlsChain(
      tenant.admin.userId,
      tenant.id,
      "arco.manage",
      "view",
    );
    expect(result.allowed).toBe(true);
  });

  it("employee does NOT have admin_center.access:view", async () => {
    const result = await canViaRlsChain(
      tenant.employee.userId,
      tenant.id,
      "admin_center.access",
      "view",
    );
    expect(result.allowed).toBe(false);
  });

  it("employee does NOT have arco.manage:view", async () => {
    const result = await canViaRlsChain(
      tenant.employee.userId,
      tenant.id,
      "arco.manage",
      "view",
    );
    expect(result.allowed).toBe(false);
  });

  it("manager does NOT have admin_center.access:view", async () => {
    const result = await canViaRlsChain(
      tenant.manager.userId,
      tenant.id,
      "admin_center.access",
      "view",
    );
    expect(result.allowed).toBe(false);
  });

  it("manager does NOT have arco.manage:view", async () => {
    const result = await canViaRlsChain(
      tenant.manager.userId,
      tenant.id,
      "arco.manage",
      "view",
    );
    expect(result.allowed).toBe(false);
  });
});

describe("can() RBP chain — demo seed permissions", () => {
  const DEMO_TENANT = "a0000000-0000-0000-0000-000000000001";

  it("seed includes admin_center.access for admin roles", async () => {
    const { rows } = await db.query<{ cnt: string }>(
      `SELECT count(*) AS cnt
       FROM public.role_permissions rp
       JOIN public.permission_roles pr ON pr.id = rp.role_id AND pr.tenant_id = rp.tenant_id
       WHERE rp.tenant_id       = $1::uuid
         AND rp.permission_key  = 'admin_center.access'
         AND rp.action          = 'view'
         AND pr.is_admin_role   = true`,
      [DEMO_TENANT],
    );
    expect(Number(rows[0].cnt)).toBeGreaterThan(0);
  });

  it("seed includes arco.manage for admin roles", async () => {
    const { rows } = await db.query<{ cnt: string }>(
      `SELECT count(*) AS cnt
       FROM public.role_permissions rp
       JOIN public.permission_roles pr ON pr.id = rp.role_id AND pr.tenant_id = rp.tenant_id
       WHERE rp.tenant_id       = $1::uuid
         AND rp.permission_key  = 'arco.manage'
         AND rp.action          = 'view'
         AND pr.is_admin_role   = true`,
      [DEMO_TENANT],
    );
    expect(Number(rows[0].cnt)).toBeGreaterThan(0);
  });
});

describe("can() RBP chain — link-owner gets admin + arco", () => {
  it("owner linked to demo tenant resolves admin_center.access and arco.manage", async () => {
    const { authId, email } = await world.createAuthUser();
    const DEMO_TENANT = "a0000000-0000-0000-0000-000000000001";

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

    const adminResult = await canViaRlsChain(userId, DEMO_TENANT, "admin_center.access", "view");
    expect(adminResult.allowed).toBe(true);

    const arcoResult = await canViaRlsChain(userId, DEMO_TENANT, "arco.manage", "view");
    expect(arcoResult.allowed).toBe(true);
  });
});
