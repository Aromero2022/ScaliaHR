import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld } from "./helpers/world";

const env = integrationEnv();

process.env.DATABASE_URL = env.prismaDbUrl;
process.env.ADMIN_DATABASE_URL = env.dbUrl;

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: () => mockGetUser(),
      refreshSession: vi.fn().mockResolvedValue({}),
    },
  }),
}));

const { createTenant } = await import("@/lib/admin/create-tenant");
const { adminPrisma } = await import("@/lib/db/admin-client");

const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

let authUser: { authId: string; email: string };
let createdTenantId: string | null = null;

let existingAuthUser: { authId: string; email: string };
let existingTenantId: string;

beforeAll(async () => {
  authUser = await world.createAuthUser();
  mockGetUser.mockResolvedValue({
    data: { user: { id: authUser.authId, email: authUser.email } },
    error: null,
  });

  existingAuthUser = await world.createAuthUser();
  existingTenantId = randomUUID();
  await db.query(
    `INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Existing Co', $2)`,
    [existingTenantId, `existing-${existingTenantId.slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO public.users (auth_uid, tenant_id, email, first_name, last_name, status)
     VALUES ($1::uuid, $2, $3, 'Existing', 'User', 'ACTIVE')`,
    [existingAuthUser.authId, existingTenantId, existingAuthUser.email],
  );
}, 15_000);

afterAll(async () => {
  try {
    if (createdTenantId) {
      const tables = [
        "role_permissions", "role_grants", "group_members",
        "permission_roles", "permission_groups",
        "user_tenant_memberships",
      ];
      for (const t of tables) {
        await db.query(`DELETE FROM public."${t}" WHERE tenant_id = $1`, [createdTenantId]);
      }
      await db.query(`DELETE FROM public.user_settings WHERE active_tenant_id = $1`, [createdTenantId]);
      await db.query("DELETE FROM public.users WHERE auth_uid = $1::uuid", [authUser.authId]);
      await db.query("DELETE FROM public.tenants WHERE id = $1", [createdTenantId]);
    }
    await db.query("DELETE FROM public.users WHERE auth_uid = $1::uuid", [existingAuthUser.authId]);
    await db.query("DELETE FROM public.tenants WHERE id = $1", [existingTenantId]);
    await world.cleanup();
  } finally {
    await db.end();
    await adminPrisma.$disconnect();
  }
}, 15_000);

describe("createTenant() produces same structure as seed.sql demo tenant", () => {
  it("creates all 4 roles, 3 groups, and full permission set", async () => {
    const result = await createTenant({
      name: "CT Integration Test",
      slug: `ct-it-${Date.now()}`,
      rfc: "",
      modules: {
        employee_central: true,
        recruiting: false,
        performance: true,
        lms: true,
      },
    });

    expect(result).toHaveProperty("success", true);
    expect(result).toHaveProperty("tenantId");
    createdTenantId = (result as { tenantId: string }).tenantId;

    const { rows: roles } = await db.query<{ name: string; is_admin_role: boolean }>(
      `SELECT name, is_admin_role FROM public.permission_roles WHERE tenant_id = $1 ORDER BY name`,
      [createdTenantId],
    );
    expect(roles.map((r) => r.name).sort()).toEqual([
      "Employee (Self-Service)", "HR Administrator", "Manager", "Owner",
    ]);
    expect(roles.filter((r) => r.is_admin_role).map((r) => r.name).sort()).toEqual([
      "HR Administrator", "Owner",
    ]);

    const { rows: groups } = await db.query<{ name: string }>(
      `SELECT name FROM public.permission_groups WHERE tenant_id = $1 ORDER BY name`,
      [createdTenantId],
    );
    expect(groups.map((g) => g.name).sort()).toEqual([
      "All Administrators", "All Employees", "All Managers",
    ]);

    const { rows: grants } = await db.query<{
      role_name: string; group_name: string; target_population: string;
    }>(
      `SELECT pr.name AS role_name, pg.name AS group_name, rg.target_population
       FROM public.role_grants rg
       JOIN public.permission_roles pr ON pr.id = rg.role_id
       JOIN public.permission_groups pg ON pg.id = rg.granted_group_id
       WHERE rg.tenant_id = $1
       ORDER BY pr.name, pg.name`,
      [createdTenantId],
    );
    expect(grants).toEqual(
      expect.arrayContaining([
        { role_name: "Owner", group_name: "All Administrators", target_population: "all" },
        { role_name: "HR Administrator", group_name: "All Administrators", target_population: "all" },
        { role_name: "Employee (Self-Service)", group_name: "All Employees", target_population: "self" },
        { role_name: "Manager", group_name: "All Managers", target_population: "direct_reports" },
      ]),
    );
    expect(grants).toHaveLength(4);
  }, 30_000);

  it("Owner + HR Admin share same admin permissions as seed.sql", async () => {
    if (!createdTenantId) throw new Error("createTenant did not produce a tenant");

    const { rows: ownerPerms } = await db.query<{ permission_key: string; action: string }>(
      `SELECT rp.permission_key, rp.action
       FROM public.role_permissions rp
       JOIN public.permission_roles pr ON pr.id = rp.role_id
       WHERE rp.tenant_id = $1 AND pr.name = 'Owner'
       ORDER BY rp.permission_key, rp.action`,
      [createdTenantId],
    );

    const { rows: hrPerms } = await db.query<{ permission_key: string; action: string }>(
      `SELECT rp.permission_key, rp.action
       FROM public.role_permissions rp
       JOIN public.permission_roles pr ON pr.id = rp.role_id
       WHERE rp.tenant_id = $1 AND pr.name = 'HR Administrator'
       ORDER BY rp.permission_key, rp.action`,
      [createdTenantId],
    );

    const ownerKeys = new Set(ownerPerms.map((p) => `${p.permission_key}:${p.action}`));
    const hrKeys = new Set(hrPerms.map((p) => `${p.permission_key}:${p.action}`));

    expect(ownerKeys.has("admin.manage_tenant:edit")).toBe(true);
    expect(ownerKeys.has("admin.manage_billing:edit")).toBe(true);
    expect(hrKeys.has("admin.manage_tenant:edit")).toBe(false);
    expect(hrKeys.has("admin.manage_billing:edit")).toBe(false);

    for (const shared of [
      "admin_center.access:view", "arco.manage:view",
      "ec.manage_employees:view", "ec.manage_employees:edit",
    ]) {
      expect(ownerKeys.has(shared)).toBe(true);
      expect(hrKeys.has(shared)).toBe(true);
    }
  });

  it("Employee (Self-Service) has correct permissions", async () => {
    if (!createdTenantId) throw new Error("createTenant did not produce a tenant");

    const { rows } = await db.query<{ permission_key: string; action: string }>(
      `SELECT rp.permission_key, rp.action
       FROM public.role_permissions rp
       JOIN public.permission_roles pr ON pr.id = rp.role_id
       WHERE rp.tenant_id = $1 AND pr.name = 'Employee (Self-Service)'
       ORDER BY rp.permission_key, rp.action`,
      [createdTenantId],
    );
    const keys = new Set(rows.map((r) => `${r.permission_key}:${r.action}`));

    for (const expected of [
      "ec.view_own_profile:view", "ec.view_org_chart:view",
      "pmgm.view_own_goals:view", "pmgm.view_own_goals:edit",
      "pmgm.give_feedback:edit", "lms.access:view",
      "tih.ontology:view", "tih.employee_skills:view", "tih.employee_skills:edit",
    ]) {
      expect(keys.has(expected), `missing ${expected}`).toBe(true);
    }
    expect(keys.has("admin_center.access:view")).toBe(false);
  });

  it("Manager has correct permissions (including tih.manager_assessment:edit)", async () => {
    if (!createdTenantId) throw new Error("createTenant did not produce a tenant");

    const { rows } = await db.query<{ permission_key: string; action: string }>(
      `SELECT rp.permission_key, rp.action
       FROM public.role_permissions rp
       JOIN public.permission_roles pr ON pr.id = rp.role_id
       WHERE rp.tenant_id = $1 AND pr.name = 'Manager'
       ORDER BY rp.permission_key, rp.action`,
      [createdTenantId],
    );
    const keys = new Set(rows.map((r) => `${r.permission_key}:${r.action}`));

    for (const expected of [
      "ec.view_team_profiles:view", "pmgm.manage_team_goals:edit",
      "tih.manager_assessment:edit",
    ]) {
      expect(keys.has(expected), `missing ${expected}`).toBe(true);
    }
    expect(keys.has("ec.manage_employees:edit")).toBe(false);
  });

  it("owner is in All Administrators AND All Employees groups", async () => {
    if (!createdTenantId) throw new Error("createTenant did not produce a tenant");

    const { rows: userRows } = await db.query<{ id: string }>(
      "SELECT id FROM public.users WHERE auth_uid = $1::uuid",
      [authUser.authId],
    );
    const userId = userRows[0].id;

    const { rows: memberships } = await db.query<{ group_name: string }>(
      `SELECT pg.name AS group_name
       FROM public.group_members gm
       JOIN public.permission_groups pg ON pg.id = gm.group_id
       WHERE gm.tenant_id = $1 AND gm.user_id = $2::uuid
       ORDER BY pg.name`,
      [createdTenantId, userId],
    );
    expect(memberships.map((m) => m.group_name).sort()).toEqual([
      "All Administrators", "All Employees",
    ]);
  });

  it("rejects if auth user already belongs to another tenant", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: existingAuthUser.authId, email: existingAuthUser.email } },
      error: null,
    });

    const result = await createTenant({
      name: "Should Fail",
      slug: `ct-fail-${Date.now()}`,
      rfc: "",
      modules: {
        employee_central: true,
        recruiting: false,
        performance: true,
        lms: true,
      },
    });

    expect(result).toHaveProperty("error", "El usuario ya pertenece a otra empresa");
    expect(result).not.toHaveProperty("success");
  });
});
