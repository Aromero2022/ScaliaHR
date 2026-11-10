import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant, type TestUser } from "./helpers/world";

/**
 * D47 — what a person reads equals what can() allows. For every table the
 * policies limit and every account, the exact set visible through the Data
 * API (the account's token) and through Prisma (prisma_app, the role of
 * DATABASE_URL, with the same JWT claims) is compared with the rows of the
 * account's tenant that are its own or that can() allows, with the modules on
 * and off.
 *
 * Accounts: an HR administrator (all), a manager (direct_reports), the
 * manager's report, a peer (self), a department viewer (same_department), an
 * owner whose is_admin_role role has no data key, and an employee of another
 * tenant.
 */

const env = integrationEnv();
process.env.DATABASE_URL = env.prismaAppDbUrl;

const mockGetClaims = vi.fn();
vi.mock("@/lib/supabase/claims", () => ({
  getClaims: (...args: unknown[]) => mockGetClaims(...args),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: (fn: (...a: unknown[]) => unknown) => fn };
});

const { can, PERMISSION_MODULE_MAP } = await import("@/lib/authz/can");
const { prisma } = await import("@/lib/db/tenant-client");

const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

type Account = { name: string; tenantId: string; user: TestUser; claims: Record<string, unknown> };
type Rule = (account: Account, row: Row) => Promise<boolean>;
type Row = { id: string; tenant_id: string; user_id: string; author_id?: string; visibility?: string; granted_group_id?: string };

let tenant: TestTenant;
let other: TestTenant;
const accounts: Account[] = [];
const tenantUserIds: string[] = [];
const closedRows: { nominee: string; entry: string }[] = [];

const claimsOf = (token: string): Record<string, unknown> => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());

async function allows(account: Account, key: string, action: "view" | "edit", target?: string): Promise<boolean> {
  mockGetClaims.mockResolvedValue({ userId: account.user.authId, email: "", tenantId: account.tenantId, appRole: null, aal: "aal1" as const });
  return (await can(account.user.userId, key, action, target)).allowed;
}

/** Own rows, plus the targets can() allows for any of the keys. */
const ownOr =
  (...keys: [string, "view" | "edit"][]): Rule =>
  async (account, row) => {
    if (row.user_id === account.user.userId) return true;
    for (const [key, action] of keys) if (await allows(account, key, action, row.user_id)) return true;
    return false;
  };

/** Own rows, plus every row of the tenant if can() allows the key (no target). */
const ownOrPermission =
  (key: string, action: "view" | "edit"): Rule =>
  async (account, row) =>
    row.user_id === account.user.userId || (await allows(account, key, action));

async function expected(rows: Row[], rule: Rule, account: Account): Promise<string[]> {
  const visible: string[] = [];
  for (const row of rows) if (row.tenant_id === account.tenantId && (await rule(account, row))) visible.push(row.id);
  return visible.sort();
}

async function viaApi(account: Account, table: string, idColumn = "id"): Promise<string[]> {
  const { data, error } = await account.user.client.from(table).select(idColumn);
  if (error) throw new Error(`${account.name} ${table}: ${error.code} ${error.message}`);
  return (data as unknown as Record<string, string>[]).map((r) => r[idColumn]).sort();
}

async function viaPrisma<T>(account: Account, sql: string, ...params: unknown[]): Promise<T[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('request.jwt.claims', ${JSON.stringify(account.claims)}, true)`;
    return tx.$queryRawUnsafe<T[]>(sql, ...params);
  });
}

async function viaPrismaIds(account: Account, table: string, idColumn = "id"): Promise<string[]> {
  const rows = await viaPrisma<{ id: string }>(account, `SELECT ${idColumn}::text AS id FROM public.${table}`);
  return rows.map((r) => r.id).sort();
}

/** Every row of both tenants, read as postgres, with the user it belongs to. */
async function rowsOf(table: string, userColumn: string, extra = "", idColumn = "id"): Promise<Row[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${idColumn}::text AS id, tenant_id::text, ${userColumn}::text AS user_id${extra} FROM public.${table} WHERE tenant_id = ANY($1::uuid[])`,
    [[tenant.id, other.id]],
  );
  return rows;
}

// employee_skills has no id: one row per person here, so user_id identifies it.
const TABLES: { table: string; userColumn: string; rule: Rule; extra?: string; idColumn?: string }[] = [
  { table: "ec_compensation", userColumn: "user_id", rule: ownOr(["ec.view_compensation", "view"]) },
  { table: "ec_personal_information", userColumn: "user_id", rule: ownOr(["ec.view_team_profiles", "view"], ["ec.manage_employees", "view"]) },
  { table: "ec_job_information", userColumn: "user_id", rule: ownOr(["ec.view_team_profiles", "view"], ["ec.manage_employees", "view"]) },
  { table: "employee_skills", userColumn: "user_id", idColumn: "user_id", rule: ownOr(["tih.employee_skills", "view"]) },
  { table: "performance_goals", userColumn: "user_id", rule: ownOr(["pmgm.manage_team_goals", "edit"], ["pmgm.manage_goal_plans", "edit"]) },
  { table: "arco_requests", userColumn: "subject_id", rule: ownOrPermission("arco.manage", "view") },
  { table: "group_members", userColumn: "user_id", rule: ownOrPermission("admin.manage_roles", "edit") },
  { table: "lms_user_map", userColumn: "user_id", rule: ownOrPermission("admin.manage_roles", "edit") },
  {
    table: "audit_logs",
    userColumn: "user_id",
    // No own rows: only whoever holds the key reads the tenant's log.
    rule: async (account) => allows(account, "admin.view_audit_logs", "view"),
  },
  {
    table: "continuous_feedbacks",
    userColumn: "subject_id",
    extra: ", author_id::text, visibility::text",
    // Author and subject always; others only if not PRIVATE and the subject is in their population.
    rule: async (account, row) =>
      row.author_id === account.user.userId ||
      row.user_id === account.user.userId ||
      (row.visibility !== "PRIVATE" && (await allows(account, "pmgm.view_team_feedback", "view", row.user_id))),
  },
  {
    table: "role_grants",
    userColumn: "granted_group_id",
    rule: async (account, row) => {
      const { rows } = await db.query("SELECT 1 FROM public.group_members WHERE group_id = $1 AND user_id = $2", [row.user_id, account.user.userId]);
      return rows.length > 0 || (await allows(account, "admin.manage_roles", "edit"));
    },
  },
];

async function addToGroup(tenantId: string, groupId: string, userId: string) {
  await db.query("INSERT INTO public.group_members (tenant_id, group_id, user_id) VALUES ($1, $2, $3)", [tenantId, groupId, userId]);
}

/** A group granted one role with the given keys and population. */
async function roleFor(tenantId: string, name: string, isAdmin: boolean, population: string, keys: [string, string][]): Promise<string> {
  const groupId = randomUUID();
  const roleId = randomUUID();
  await db.query("INSERT INTO public.permission_groups (id, tenant_id, name) VALUES ($1, $2, $3)", [groupId, tenantId, name]);
  await db.query("INSERT INTO public.permission_roles (id, tenant_id, name, is_admin_role) VALUES ($1, $2, $3, $4)", [roleId, tenantId, name, isAdmin]);
  for (const [key, action] of keys) {
    await db.query("INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action) VALUES ($1, $2, $3, $4)", [tenantId, roleId, key, action]);
  }
  await db.query("INSERT INTO public.role_grants (tenant_id, role_id, granted_group_id, target_population) VALUES ($1, $2, $3, $4)", [tenantId, roleId, groupId, population]);
  return groupId;
}

/** One row per person in every table, a few feedbacks of each visibility, and rows in the closed tables. */
async function seedRows(t: TestTenant, people: string[], withJob: string[]) {
  for (const userId of withJob) {
    await db.query("INSERT INTO public.ec_job_information (tenant_id, user_id, start_date, job_title) VALUES ($1, $2, DATE '2026-01-01', 'Analyst')", [t.id, userId]);
  }
  const { rows: skill } = await db.query<{ id: string }>(
    "INSERT INTO public.skill_ontology (tenant_id, code, name) VALUES ($1, $2, 'D47 skill') RETURNING id",
    [t.id, `d47-${t.id.slice(0, 8)}`],
  );
  for (const [n, userId] of people.entries()) {
    await db.query("INSERT INTO public.ec_compensation (tenant_id, user_id, start_date, base_salary) VALUES ($1, $2, DATE '2026-01-01', 1000)", [t.id, userId]);
    await db.query("INSERT INTO public.ec_personal_information (tenant_id, user_id, start_date, first_name, last_name) VALUES ($1, $2, DATE '2026-01-01', 'D47', 'Persona')", [t.id, userId]);
    await db.query("INSERT INTO public.employee_skills (tenant_id, user_id, skill_id) VALUES ($1, $2, $3)", [t.id, userId, skill[0].id]);
    await db.query("INSERT INTO public.performance_goals (tenant_id, user_id, title, period_start, period_end) VALUES ($1, $2, 'D47 goal', '2026-01-01', '2026-12-31')", [t.id, userId]);
    await db.query(
      "INSERT INTO public.arco_requests (tenant_id, requester_id, subject_id, request_type, description, due_date) VALUES ($1, $2, $2, 'acceso', 'D47', DATE '2026-12-31')",
      [t.id, userId],
    );
    await db.query("INSERT INTO public.lms_user_map (tenant_id, user_id, moodle_user_id) VALUES ($1, $2, $3)", [t.id, userId, 470000 + n + (t.id === tenant.id ? 0 : 100)]);
    await db.query("UPDATE public.users SET performance_score = $2, potential_score = $2 WHERE id = $1", [userId, 3 + n / 10]);
  }
  await db.query("INSERT INTO public.audit_logs (tenant_id, user_id, action) VALUES ($1, $2, 'D47_PROBE')", [t.id, people[0]]);

  const { rows: plan } = await db.query<{ id: string }>("INSERT INTO public.succession_plans (tenant_id, position_title) VALUES ($1, 'D47') RETURNING id", [t.id]);
  const { rows: pool } = await db.query<{ id: string }>("INSERT INTO public.talent_pools (tenant_id, name) VALUES ($1, 'D47') RETURNING id", [t.id]);
  const { rows: nominee } = await db.query<{ id: string }>("INSERT INTO public.succession_nominees (succession_plan_id, user_id) VALUES ($1, $2) RETURNING id", [plan[0].id, people[0]]);
  const { rows: entry } = await db.query<{ id: string }>("INSERT INTO public.talent_pool_entries (talent_pool_id, user_id) VALUES ($1, $2) RETURNING id", [pool[0].id, people[0]]);
  await db.query("INSERT INTO public.job_informations (tenant_id, title) VALUES ($1, 'D47')", [t.id]);
  closedRows.push({ nominee: nominee[0].id, entry: entry[0].id });
}

async function feedback(tenantId: string, author: string, subject: string, visibility: string) {
  await db.query(
    "INSERT INTO public.continuous_feedbacks (tenant_id, author_id, subject_id, content, visibility) VALUES ($1, $2, $3, 'D47', $4)",
    [tenantId, author, subject, visibility],
  );
}

async function setModules(on: boolean) {
  await db.query("UPDATE public.tenants SET is_ec_active = $2, is_pmgm_active = $2, is_tih_active = $2 WHERE id = $1", [tenant.id, on]);
}

beforeAll(async () => {
  tenant = await world.createTenant();
  other = await world.createTenant();

  const peer = await world.addMember(tenant.id, "employee");
  const deptViewer = await world.addMember(tenant.id, "employee");
  const keylessOwner = await world.addMember(tenant.id, "owner");
  await addToGroup(tenant.id, tenant.employeeGroupId, peer.userId);

  // The directory needs ec.view_org_chart, which the employees hold (seed).
  await db.query("INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action) VALUES ($1, $2, 'ec.view_org_chart', 'view')", [tenant.id, tenant.employeeRoleId]);

  // same_department: the viewer and the peer share a department.
  const { rows: dept } = await db.query<{ id: string }>("INSERT INTO public.departments (tenant_id, name) VALUES ($1, 'D47') RETURNING id", [tenant.id]);
  await db.query("UPDATE public.users SET department_id = $1 WHERE id = ANY($2::uuid[])", [dept[0].id, [peer.userId, deptViewer.userId]]);
  await addToGroup(tenant.id, await roleFor(tenant.id, "Department viewers", false, "same_department", [["ec.view_team_profiles", "view"]]), deptViewer.userId);

  // is_admin_role and app_role owner, but no data key.
  await addToGroup(tenant.id, await roleFor(tenant.id, "Keyless admins", true, "all", [["admin_center.access", "view"]]), keylessOwner.userId);

  const people = [tenant.admin, tenant.manager, tenant.employee, peer, deptViewer, keylessOwner].map((u) => u.userId);
  tenantUserIds.push(...people);
  await seedRows(tenant, people, [tenant.admin.userId, peer.userId, deptViewer.userId, keylessOwner.userId]);
  await seedRows(other, [other.admin, other.manager, other.employee].map((u) => u.userId), [other.admin.userId]);

  await feedback(tenant.id, tenant.employee.userId, peer.userId, "PRIVATE");
  await feedback(tenant.id, peer.userId, tenant.employee.userId, "MANAGER_ONLY");
  await feedback(tenant.id, tenant.admin.userId, tenant.employee.userId, "PUBLIC");
  await feedback(tenant.id, peer.userId, tenant.employee.userId, "PRIVATE");
  await feedback(tenant.id, tenant.employee.userId, tenant.manager.userId, "PUBLIC");
  await feedback(other.id, other.employee.userId, other.manager.userId, "PUBLIC");

  for (const [name, t, user] of [
    ["hr admin (all)", tenant, tenant.admin],
    ["manager (direct_reports)", tenant, tenant.manager],
    ["report (self)", tenant, tenant.employee],
    ["peer (self)", tenant, peer],
    ["department viewer (same_department)", tenant, deptViewer],
    ["owner without keys (is_admin_role)", tenant, keylessOwner],
    ["other tenant's employee", other, other.employee],
  ] as const) {
    accounts.push({ name, tenantId: t.id, user, claims: claimsOf(user.token) });
  }
});

afterAll(async () => {
  try {
    // No tenant_id on these two, so world.cleanup() does not reach them.
    await db.query("DELETE FROM public.succession_nominees WHERE id = ANY($1::uuid[])", [closedRows.map((r) => r.nominee)]);
    await db.query("DELETE FROM public.talent_pool_entries WHERE id = ANY($1::uuid[])", [closedRows.map((r) => r.entry)]);
    await world.cleanup();
  } finally {
    await prisma.$disconnect();
    await db.end();
  }
});

for (const modulesOn of [true, false]) {
  describe(`reads equal own ∪ can() (D47), modules ${modulesOn ? "on" : "off (ec, pmgm, tih)"}`, () => {
    beforeAll(async () => {
      await setModules(modulesOn);
    });
    afterAll(async () => {
      await setModules(true);
    });

    for (const { table, userColumn, rule, extra, idColumn } of TABLES) {
      it(`${table}: Data API and Prisma see exactly what can() allows`, async () => {
        const rows = await rowsOf(table, userColumn, extra, idColumn);
        const actual: Record<string, { api: string[]; prisma: string[] }> = {};
        const wanted: Record<string, { api: string[]; prisma: string[] }> = {};
        for (const account of accounts) {
          const exp = await expected(rows, rule, account);
          wanted[account.name] = { api: exp, prisma: exp };
          actual[account.name] = { api: await viaApi(account, table, idColumn), prisma: await viaPrismaIds(account, table, idColumn) };
        }
        expect(actual).toEqual(wanted);
      });
    }

    it("talent scores: own, or the population of ec.manage_employees", async () => {
      const rows: Row[] = tenantUserIds.map((id) => ({ id, tenant_id: tenant.id, user_id: id }));
      const rule = ownOr(["ec.manage_employees", "view"]);
      const actual: Record<string, { api: string[]; prisma: string[] }> = {};
      const wanted: Record<string, { api: string[]; prisma: string[] }> = {};
      for (const account of accounts) {
        const exp = await expected(rows, rule, account);
        wanted[account.name] = { api: exp, prisma: exp };
        const { data, error } = await account.user.client.rpc("talent_scores", { p_user_ids: tenantUserIds });
        if (error) throw new Error(`${account.name}: ${error.message}`);
        const viaP = await viaPrisma<{ user_id: string }>(account, "SELECT user_id::text FROM public.talent_scores($1::uuid[])", tenantUserIds);
        actual[account.name] = {
          api: (data as { user_id: string }[]).map((r) => r.user_id).sort(),
          prisma: viaP.map((r) => r.user_id).sort(),
        };
      }
      expect(actual).toEqual(wanted);
    });

    it("directory: the tenant's names, titles and departments with ec.view_org_chart, 42501 without", async () => {
      const actual: Record<string, string[] | "42501"> = {};
      const wanted: Record<string, string[] | "42501"> = {};
      for (const account of accounts) {
        const ids = account.tenantId === tenant.id ? [...tenantUserIds].sort() : [];
        wanted[account.name] = (await allows(account, "ec.view_org_chart", "view")) ? ids : "42501";
        const { data, error } = await account.user.client.rpc("directory_entries", { p_user_ids: tenantUserIds });
        if (error && error.code !== "42501") throw new Error(`${account.name}: ${error.code} ${error.message}`);
        const viaA = error ? "42501" : (data as { user_id: string }[]).map((r) => r.user_id).sort();
        const viaP = await viaPrisma<{ user_id: string }>(account, "SELECT user_id::text FROM public.directory_entries($1::uuid[])", tenantUserIds).then(
          (rows) => rows.map((r) => r.user_id).sort(),
          (e: unknown) => {
            if (String(e).includes("42501")) return "42501" as const;
            throw e;
          },
        );
        expect({ account: account.name, prisma: viaP }).toEqual({ account: account.name, prisma: viaA });
        actual[account.name] = viaA;
      }
      expect(actual).toEqual(wanted);
    });

    it("job_informations, succession_nominees and talent_pool_entries are closed to everyone", async () => {
      for (const table of ["job_informations", "succession_nominees", "talent_pool_entries"]) {
        const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.${table}`);
        expect(rows[0].n).toBeGreaterThan(0);
        for (const account of accounts) {
          expect({ table, account: account.name, api: await viaApi(account, table), prisma: await viaPrismaIds(account, table) }).toEqual({
            table,
            account: account.name,
            api: [],
            prisma: [],
          });
        }
      }
    });
  });
}

describe("the comparison is not vacuous", () => {
  it("compensation: the HR admin sees the tenant, the manager the report, the others themselves", async () => {
    const rows = await rowsOf("ec_compensation", "user_id");
    const owners = new Map(rows.map((r) => [r.id, r.user_id]));
    const seen = async (name: string) => (await viaApi(accounts.find((a) => a.name === name)!, "ec_compensation")).map((id) => owners.get(id)).sort();
    expect(await seen("hr admin (all)")).toEqual([...tenantUserIds].sort());
    expect(await seen("manager (direct_reports)")).toEqual([tenant.manager.userId, tenant.employee.userId].sort());
    expect(await seen("report (self)")).toEqual([tenant.employee.userId]);
    expect(await seen("owner without keys (is_admin_role)")).toEqual([accounts.find((a) => a.name === "owner without keys (is_admin_role)")!.user.userId]);
    expect(await seen("other tenant's employee")).toEqual([other.employee.userId]);
  });

  it("the department viewer sees the peer's job but not the report's", async () => {
    const viewer = accounts.find((a) => a.name === "department viewer (same_department)")!;
    const peer = accounts.find((a) => a.name === "peer (self)")!;
    const { data } = await viewer.user.client.from("ec_job_information").select("user_id");
    expect((data as { user_id: string }[]).map((r) => r.user_id).sort()).toEqual([viewer.user.userId, peer.user.userId].sort());
  });

  it("the scores are not readable as columns, by the Data API or by Prisma", async () => {
    const account = accounts[0];
    const { error } = await account.user.client.from("users").select("id, performance_score");
    expect(error?.code).toBe("42501");
    await expect(viaPrisma(account, "SELECT performance_score FROM public.users")).rejects.toThrow(/42501|permission denied/);
  });
});

describe("rbp_module_active() reads the same flag per prefix as can() (PERMISSION_MODULE_MAP)", () => {
  it("turning off one module's flag turns off only that prefix; other prefixes are always on", async () => {
    const prefixes = Object.keys(PERMISSION_MODULE_MAP);
    await db.query("BEGIN");
    try {
      for (const [prefix, column] of Object.entries(PERMISSION_MODULE_MAP)) {
        const sets = Object.values(PERMISSION_MODULE_MAP).map((c) => `${c} = ${c === column ? "false" : "true"}`).join(", ");
        await db.query(`UPDATE public.tenants SET ${sets} WHERE id = $1`, [tenant.id]);
        const { rows } = await db.query<{ prefix: string; active: boolean }>(
          "SELECT p AS prefix, public.rbp_module_active($1, p || '.key') AS active FROM unnest($2::text[]) AS p",
          [tenant.id, [...prefixes, "admin", "arco", "employee_profile"]],
        );
        expect(Object.fromEntries(rows.map((r) => [r.prefix, r.active]))).toEqual(
          Object.fromEntries([...prefixes.map((p) => [p, p !== prefix]), ["admin", true], ["arco", true], ["employee_profile", true]]),
        );
      }
    } finally {
      await db.query("ROLLBACK");
    }
  });
});
