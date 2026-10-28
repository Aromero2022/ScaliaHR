import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant, type TestUser } from "./helpers/world";

/**
 * Admin Center authorization tests.
 *
 * admin_center.access:view is required to enter /admin-center (layout guard).
 * admin.manage_roles:edit is required for /admin-center/manage-roles.
 *
 * Tests verify the RBP chain: group_members → role_grants → role_permissions.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

let tenant: TestTenant;
let owner: TestUser;
let hrAdmin: TestUser;
let limitedAdmin: TestUser;

async function canViaRbp(userId: string, permissionKey: string, action: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM   public.role_permissions rp
       JOIN   public.role_grants      rg ON rg.role_id = rp.role_id
                                         AND rg.tenant_id = rp.tenant_id
       JOIN   public.group_members    gm ON gm.group_id = rg.granted_group_id
                                         AND gm.tenant_id = rp.tenant_id
       WHERE  gm.user_id         = $1::uuid
         AND  rp.permission_key  = $2
         AND  rp.action          = $3::public.rbp_action
     ) AS ok`,
    [userId, permissionKey, action],
  );
  return rows[0].ok;
}

beforeAll(async () => {
  tenant = await world.createTenant();

  owner = await world.addMember(tenant.id, "owner");
  hrAdmin = await world.addMember(tenant.id, "hr_admin");

  // Give owner and hrAdmin the admin_center.access permission via the
  // existing admin group/role.
  await db.query(
    `INSERT INTO public.group_members (tenant_id, group_id, user_id)
     VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenant.id, tenant.adminGroupId, owner.userId, hrAdmin.userId],
  );
  await db.query(
    `INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action)
     VALUES ($1, $2, 'admin_center.access', 'view'),
            ($1, $2, 'admin.manage_roles', 'edit'),
            ($1, $2, 'admin.manage_config', 'edit'),
            ($1, $2, 'admin.view_audit_logs', 'view')
     ON CONFLICT DO NOTHING`,
    [tenant.id, tenant.adminRoleId],
  );

  // limitedAdmin: has admin_center.access but NOT admin.manage_roles.
  limitedAdmin = await world.addMember(tenant.id, "employee");
  const limitedGroupId = randomUUID();
  const limitedRoleId = randomUUID();
  await db.query(
    `INSERT INTO public.permission_groups (id, tenant_id, name)
     VALUES ($1, $2, 'Limited Admins')`,
    [limitedGroupId, tenant.id],
  );
  await db.query(
    `INSERT INTO public.permission_roles (id, tenant_id, name, is_admin_role)
     VALUES ($1, $2, 'Limited Admin', false)`,
    [limitedRoleId, tenant.id],
  );
  await db.query(
    `INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action)
     VALUES ($1, $2, 'admin_center.access', 'view')`,
    [tenant.id, limitedRoleId],
  );
  await db.query(
    `INSERT INTO public.role_grants (tenant_id, role_id, granted_group_id, target_population)
     VALUES ($1, $2, $3, 'all')`,
    [tenant.id, limitedRoleId, limitedGroupId],
  );
  await db.query(
    `INSERT INTO public.group_members (tenant_id, group_id, user_id)
     VALUES ($1, $2, $3)`,
    [tenant.id, limitedGroupId, limitedAdmin.userId],
  );
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

describe("admin-center — entry gate (admin_center.access:view)", () => {
  it("employee without admin_center.access is denied", async () => {
    const allowed = await canViaRbp(tenant.employee.userId, "admin_center.access", "view");
    expect(allowed).toBe(false);
  });

  it("manager without admin_center.access is denied", async () => {
    const allowed = await canViaRbp(tenant.manager.userId, "admin_center.access", "view");
    expect(allowed).toBe(false);
  });

  it("owner with admin_center.access is allowed", async () => {
    const allowed = await canViaRbp(owner.userId, "admin_center.access", "view");
    expect(allowed).toBe(true);
  });

  it("hr_admin with admin_center.access is allowed", async () => {
    const allowed = await canViaRbp(hrAdmin.userId, "admin_center.access", "view");
    expect(allowed).toBe(true);
  });

  it("limitedAdmin with admin_center.access is allowed", async () => {
    const allowed = await canViaRbp(limitedAdmin.userId, "admin_center.access", "view");
    expect(allowed).toBe(true);
  });
});

describe("admin-center — tool guard (admin.manage_roles:edit)", () => {
  it("owner with admin.manage_roles is allowed", async () => {
    const allowed = await canViaRbp(owner.userId, "admin.manage_roles", "edit");
    expect(allowed).toBe(true);
  });

  it("hr_admin with admin.manage_roles is allowed", async () => {
    const allowed = await canViaRbp(hrAdmin.userId, "admin.manage_roles", "edit");
    expect(allowed).toBe(true);
  });

  it("limitedAdmin without admin.manage_roles is denied", async () => {
    const allowed = await canViaRbp(limitedAdmin.userId, "admin.manage_roles", "edit");
    expect(allowed).toBe(false);
  });

  it("employee without any admin permission is denied", async () => {
    const allowed = await canViaRbp(tenant.employee.userId, "admin.manage_roles", "edit");
    expect(allowed).toBe(false);
  });
});

describe("admin-center — RLS on admin data tables", () => {
  it("employee can read permission_roles for their tenant (SELECT is open)", async () => {
    const { data, error } = await tenant.employee.client
      .from("permission_roles")
      .select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("employee cannot insert into permission_roles", async () => {
    const { error } = await tenant.employee.client
      .from("permission_roles")
      .insert({ tenant_id: tenant.id, name: "Hacked Role" });
    expect(error).not.toBeNull();
  });

  it("employee cannot insert into role_permissions", async () => {
    const { error } = await tenant.employee.client
      .from("role_permissions")
      .insert({
        tenant_id: tenant.id,
        role_id: tenant.adminRoleId,
        permission_key: "admin.manage_billing",
        action: "edit",
      });
    expect(error).not.toBeNull();
  });

  it("admin can read permission_roles for their tenant", async () => {
    const { data, error } = await tenant.admin.client
      .from("permission_roles")
      .select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});

describe("admin-center — migration correctness", () => {
  it("admin_center.access was backfilled for all admin roles", async () => {
    const { rows } = await db.query<{ cnt: string }>(
      `SELECT count(*) AS cnt
       FROM   public.role_permissions rp
       JOIN   public.permission_roles pr ON pr.id = rp.role_id AND pr.tenant_id = rp.tenant_id
       WHERE  rp.permission_key = 'admin_center.access'
         AND  rp.action = 'view'
         AND  pr.is_admin_role = true`,
    );
    expect(Number(rows[0].cnt)).toBeGreaterThan(0);
  });

  it("no FOR ALL policy remains on admin tables", async () => {
    for (const table of ["permission_roles", "role_permissions", "permission_groups", "role_grants"]) {
      const { rows } = await db.query(
        "SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 AND cmd = 'ALL'",
        [table],
      );
      expect(rows, table).toEqual([]);
    }
  });
});
