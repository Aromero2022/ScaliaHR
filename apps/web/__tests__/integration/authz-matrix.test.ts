import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld } from "./helpers/world";

const env = integrationEnv();

process.env.DATABASE_URL = env.prismaDbUrl;

const mockGetClaims = vi.fn();
vi.mock("@/lib/supabase/claims", () => ({
  getClaims: (...args: unknown[]) => mockGetClaims(...args),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: (fn: (...a: unknown[]) => unknown) => fn };
});

const { can } = await import("@/lib/authz/can");
const { prisma } = await import("@/lib/db/tenant-client");

const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

interface FullTestTenant {
  id: string;
  admin: { userId: string };
  manager: { userId: string };
  employee: { userId: string };
  otherEmployee: { userId: string };
}

let tenant: FullTestTenant;

function claimsFor(tenantId: string) {
  mockGetClaims.mockResolvedValue({
    userId: "auth-uid",
    email: "",
    tenantId,
    appRole: null,
    aal: "aal1" as const,
  });
}

async function setupFullTenant(): Promise<FullTestTenant> {
  const tid = randomUUID();
  await db.query(
    `INSERT INTO public.tenants (id, name, slug, is_ec_active, is_pmgm_active, is_tih_active, is_lms_active)
     VALUES ($1, $2, $3, true, true, true, true)`,
    [tid, `Matrix Test`, `it-matrix-${tid.slice(0, 8)}`],
  );

  const mkUser = async (name: string, appRole: string) => {
    const { authId, email } = await world.createAuthUser();
    const userId = randomUUID();
    await db.query(
      `INSERT INTO public.users (id, tenant_id, auth_uid, email, first_name, last_name, status, hire_date, employee_id)
       VALUES ($1, $2, $3, $4, $5, 'Test', 'ACTIVE', NOW(), $6)`,
      [userId, tid, authId, email, name, `IT-${userId.slice(0, 6)}`],
    );
    await db.query(
      `INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role, is_active)
       VALUES ($1, $2, $3, true)`,
      [authId, tid, appRole],
    );
    await db.query(
      "INSERT INTO public.user_settings (user_id, active_tenant_id) VALUES ($1, $2)",
      [authId, tid],
    );
    return { authId, userId, email };
  };

  const admin = await mkUser("Admin", "owner");
  const manager = await mkUser("Manager", "employee");
  const employee = await mkUser("Employee", "employee");
  const otherEmployee = await mkUser("Other", "employee");

  await db.query(
    `INSERT INTO public.ec_job_information (tenant_id, user_id, start_date, job_title, manager_id)
     VALUES ($1, $2, '2026-01-01', 'Manager', NULL),
            ($1, $3, '2026-01-01', 'Employee', $2),
            ($1, $4, '2026-01-01', 'Other Employee', $2)`,
    [tid, manager.userId, employee.userId, otherEmployee.userId],
  );

  const adminGroupId = randomUUID();
  const employeeGroupId = randomUUID();
  const managerGroupId = randomUUID();

  const ownerRoleId = randomUUID();
  const hrAdminRoleId = randomUUID();
  const employeeRoleId = randomUUID();
  const managerRoleId = randomUUID();

  await db.query(
    `INSERT INTO public.permission_groups (id, tenant_id, name) VALUES
       ($1, $4, 'All Administrators'),
       ($2, $4, 'All Employees'),
       ($3, $4, 'All Managers')`,
    [adminGroupId, employeeGroupId, managerGroupId, tid],
  );

  await db.query(
    `INSERT INTO public.permission_roles (id, tenant_id, name, is_admin_role) VALUES
       ($1, $5, 'Owner', true),
       ($2, $5, 'HR Administrator', true),
       ($3, $5, 'Employee (Self-Service)', false),
       ($4, $5, 'Manager', false)`,
    [ownerRoleId, hrAdminRoleId, employeeRoleId, managerRoleId, tid],
  );

  const adminPerms = [
    ["admin_center.access", "view"], ["arco.manage", "view"],
    ["admin.manage_roles", "edit"], ["admin.manage_config", "edit"],
    ["admin.view_audit_logs", "view"],
    ["ec.manage_employees", "view"], ["ec.manage_employees", "edit"],
    ["ec.manage_positions", "edit"], ["ec.manage_org_structure", "edit"],
    ["pmgm.manage_goal_plans", "edit"], ["sdm.manage_succession", "edit"],
    ["tih.ontology", "view"], ["tih.ontology", "edit"],
    ["tih.job_requirements", "view"], ["tih.job_requirements", "edit"],
    ["tih.employee_skills", "view"], ["tih.employee_skills", "edit"],
  ];

  for (const [key, act] of adminPerms) {
    await db.query(
      `INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action) VALUES ($1, $2, $3, $4::public.rbp_action), ($1, $5, $3, $4::public.rbp_action)`,
      [tid, ownerRoleId, key, act, hrAdminRoleId],
    );
  }

  for (const [key, act] of [["admin.manage_tenant", "edit"], ["admin.manage_billing", "edit"]]) {
    await db.query(
      `INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action) VALUES ($1, $2, $3, $4::public.rbp_action)`,
      [tid, ownerRoleId, key, act],
    );
  }

  const employeePerms = [
    ["ec.view_own_profile", "view"], ["ec.view_org_chart", "view"],
    ["pmgm.view_own_goals", "view"], ["pmgm.view_own_goals", "edit"],
    ["pmgm.give_feedback", "edit"], ["lms.access", "view"],
    ["tih.ontology", "view"], ["tih.employee_skills", "view"], ["tih.employee_skills", "edit"],
  ];
  for (const [key, act] of employeePerms) {
    await db.query(
      `INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action) VALUES ($1, $2, $3, $4::public.rbp_action)`,
      [tid, employeeRoleId, key, act],
    );
  }

  const managerPerms = [
    ["ec.view_team_profiles", "view"],
    ["pmgm.manage_team_goals", "edit"], ["pmgm.view_team_feedback", "view"],
    ["sdm.nominate_successors", "edit"],
    ["tih.ontology", "view"], ["tih.job_requirements", "view"],
    ["tih.employee_skills", "view"], ["tih.employee_skills", "edit"],
    ["tih.manager_assessment", "edit"],
  ];
  for (const [key, act] of managerPerms) {
    await db.query(
      `INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action) VALUES ($1, $2, $3, $4::public.rbp_action)`,
      [tid, managerRoleId, key, act],
    );
  }

  await db.query(
    `INSERT INTO public.role_grants (tenant_id, role_id, granted_group_id, target_population) VALUES
       ($1, $2, $5, 'all'),
       ($1, $3, $5, 'all'),
       ($1, $4, $6, 'self'),
       ($1, $7, $8, 'direct_reports')`,
    [tid, ownerRoleId, hrAdminRoleId, employeeRoleId, adminGroupId, employeeGroupId, managerRoleId, managerGroupId],
  );

  await db.query(
    `INSERT INTO public.group_members (tenant_id, group_id, user_id) VALUES
       ($1, $2, $3),
       ($1, $4, $3),
       ($1, $4, $5),
       ($1, $4, $6),
       ($1, $4, $7),
       ($1, $8, $5)`,
    [tid, adminGroupId, admin.userId, employeeGroupId, manager.userId, employee.userId, otherEmployee.userId, managerGroupId],
  );

  return { id: tid, admin, manager, employee, otherEmployee };
}

beforeAll(async () => {
  tenant = await setupFullTenant();
}, 30_000);

beforeEach(() => {
  vi.clearAllMocks();
  claimsFor(tenant.id);
});

afterAll(async () => {
  try {
    await world.cleanup();
    const tables = [
      "role_permissions", "role_grants", "group_members",
      "permission_roles", "permission_groups",
      "ec_job_information", "ec_compensation", "ec_personal_information",
      "user_tenant_memberships", "users",
    ];
    for (const t of tables) {
      await db.query(`DELETE FROM public."${t}" WHERE tenant_id = $1`, [tenant.id]);
    }
    await db.query(`DELETE FROM public.user_settings WHERE active_tenant_id = $1`, [tenant.id]);
    await db.query("DELETE FROM public.tenants WHERE id = $1", [tenant.id]);
  } finally {
    await db.end();
    await prisma.$disconnect();
  }
}, 15_000);

describe("Admin (Owner) — full access", () => {
  it("admin has admin_center.access:view", async () => {
    expect(await can(tenant.admin.userId, "admin_center.access", "view")).toEqual({ allowed: true });
  });

  it("admin has ec.manage_employees:view on any user", async () => {
    expect(await can(tenant.admin.userId, "ec.manage_employees", "view", tenant.employee.userId)).toEqual({ allowed: true });
  });

  it("admin has ec.manage_employees:edit on any user", async () => {
    expect(await can(tenant.admin.userId, "ec.manage_employees", "edit", tenant.employee.userId)).toEqual({ allowed: true });
  });

  it("admin has ec.view_org_chart:view (inherited via All Employees)", async () => {
    expect(await can(tenant.admin.userId, "ec.view_org_chart", "view")).toEqual({ allowed: true });
  });

  it("admin has pmgm.view_own_goals:view (inherited via All Employees)", async () => {
    expect(await can(tenant.admin.userId, "pmgm.view_own_goals", "view")).toEqual({ allowed: true });
  });

  it("admin has lms.access:view (inherited via All Employees)", async () => {
    expect(await can(tenant.admin.userId, "lms.access", "view")).toEqual({ allowed: true });
  });
});

describe("Manager — direct reports + self-service", () => {
  it("manager has ec.view_team_profiles:view on direct report", async () => {
    expect(await can(tenant.manager.userId, "ec.view_team_profiles", "view", tenant.employee.userId)).toEqual({ allowed: true });
  });

  it("manager DENIED ec.view_team_profiles:view on non-report", async () => {
    const result = await can(tenant.manager.userId, "ec.view_team_profiles", "view", tenant.admin.userId);
    expect(result.allowed).toBe(false);
  });

  it("manager DENIED ec.manage_employees:edit (not admin)", async () => {
    const result = await can(tenant.manager.userId, "ec.manage_employees", "edit", tenant.employee.userId);
    expect(result.allowed).toBe(false);
  });

  it("manager DENIED admin_center.access:view", async () => {
    const result = await can(tenant.manager.userId, "admin_center.access", "view");
    expect(result.allowed).toBe(false);
  });

  it("manager has ec.view_own_profile:view on self", async () => {
    expect(await can(tenant.manager.userId, "ec.view_own_profile", "view", tenant.manager.userId)).toEqual({ allowed: true });
  });

  it("manager has pmgm.view_own_goals:edit (self-service)", async () => {
    expect(await can(tenant.manager.userId, "pmgm.view_own_goals", "edit")).toEqual({ allowed: true });
  });

  it("manager has tih.manager_assessment:edit on direct report", async () => {
    expect(await can(tenant.manager.userId, "tih.manager_assessment", "edit", tenant.employee.userId)).toEqual({ allowed: true });
  });

  it("manager DENIED tih.manager_assessment:edit on non-report", async () => {
    const result = await can(tenant.manager.userId, "tih.manager_assessment", "edit", tenant.admin.userId);
    expect(result.allowed).toBe(false);
  });
});

describe("Employee — self-service only", () => {
  it("employee has ec.view_own_profile:view on self", async () => {
    expect(await can(tenant.employee.userId, "ec.view_own_profile", "view", tenant.employee.userId)).toEqual({ allowed: true });
  });

  it("employee DENIED ec.view_own_profile:view on others", async () => {
    const result = await can(tenant.employee.userId, "ec.view_own_profile", "view", tenant.admin.userId);
    expect(result.allowed).toBe(false);
  });

  it("employee has ec.view_org_chart:view", async () => {
    expect(await can(tenant.employee.userId, "ec.view_org_chart", "view")).toEqual({ allowed: true });
  });

  it("employee has pmgm.view_own_goals:view", async () => {
    expect(await can(tenant.employee.userId, "pmgm.view_own_goals", "view")).toEqual({ allowed: true });
  });

  it("employee has pmgm.view_own_goals:edit", async () => {
    expect(await can(tenant.employee.userId, "pmgm.view_own_goals", "edit")).toEqual({ allowed: true });
  });

  it("employee has pmgm.give_feedback:edit", async () => {
    expect(await can(tenant.employee.userId, "pmgm.give_feedback", "edit")).toEqual({ allowed: true });
  });

  it("employee has lms.access:view", async () => {
    expect(await can(tenant.employee.userId, "lms.access", "view")).toEqual({ allowed: true });
  });

  it("employee DENIED ec.manage_employees:edit", async () => {
    const result = await can(tenant.employee.userId, "ec.manage_employees", "edit", tenant.employee.userId);
    expect(result.allowed).toBe(false);
  });

  it("employee DENIED ec.manage_employees:view", async () => {
    const result = await can(tenant.employee.userId, "ec.manage_employees", "view", tenant.employee.userId);
    expect(result.allowed).toBe(false);
  });

  it("employee DENIED admin_center.access:view", async () => {
    const result = await can(tenant.employee.userId, "admin_center.access", "view");
    expect(result.allowed).toBe(false);
  });

  it("employee DENIED ec.view_team_profiles:view", async () => {
    const result = await can(tenant.employee.userId, "ec.view_team_profiles", "view", tenant.manager.userId);
    expect(result.allowed).toBe(false);
  });

  it("employee DENIED tih.manager_assessment:edit", async () => {
    const result = await can(tenant.employee.userId, "tih.manager_assessment", "edit", tenant.manager.userId);
    expect(result.allowed).toBe(false);
  });
});
