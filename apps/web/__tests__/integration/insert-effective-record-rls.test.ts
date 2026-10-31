import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld } from "./helpers/world";

const env = integrationEnv();

const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

let tid: string;
let ownerToken: string;
let employeeToken: string;
let ownerUserId: string;
let employeeUserId: string;

beforeAll(async () => {
  tid = randomUUID();
  await db.query(
    `INSERT INTO public.tenants (id, name, slug, is_ec_active)
     VALUES ($1, 'RLS IER Test', $2, true)`,
    [tid, `it-ier-${tid.slice(0, 8)}`],
  );

  const mkMember = async (name: string, appRole: string) => {
    const { authId, email } = await world.createAuthUser();
    const userId = randomUUID();
    await db.query(
      `INSERT INTO public.users (id, tenant_id, auth_uid, email, first_name, last_name, status, hire_date, employee_id)
       VALUES ($1, $2, $3, $4, $5, 'Test', 'ACTIVE', NOW(), $6)`,
      [userId, tid, authId, email, name, `IER-${userId.slice(0, 6)}`],
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
    const token = await world.signIn(email);
    return { authId, userId, token };
  };

  const owner = await mkMember("OwnerIER", "owner");
  const employee = await mkMember("EmpIER", "employee");
  ownerUserId = owner.userId;
  employeeUserId = employee.userId;
  ownerToken = owner.token;
  employeeToken = employee.token;

  const adminGroupId = randomUUID();
  const adminRoleId = randomUUID();
  await db.query(
    `INSERT INTO public.permission_groups (id, tenant_id, name)
     VALUES ($1, $2, 'Admins')`,
    [adminGroupId, tid],
  );
  await db.query(
    `INSERT INTO public.permission_roles (id, tenant_id, name, is_admin_role)
     VALUES ($1, $2, 'Admin', true)`,
    [adminRoleId, tid],
  );
  await db.query(
    `INSERT INTO public.role_grants (tenant_id, role_id, granted_group_id, target_population)
     VALUES ($1, $2, $3, 'all')`,
    [tid, adminRoleId, adminGroupId],
  );
  await db.query(
    `INSERT INTO public.group_members (tenant_id, group_id, user_id)
     VALUES ($1, $2, $3)`,
    [tid, adminGroupId, ownerUserId],
  );
}, 30_000);

afterAll(async () => {
  try {
    const tables = [
      "ec_job_information", "ec_compensation", "ec_personal_information",
      "role_permissions", "role_grants", "group_members",
      "permission_roles", "permission_groups",
      "user_tenant_memberships", "user_settings", "users",
    ];
    for (const t of tables) {
      await db.query(`DELETE FROM public."${t}" WHERE tenant_id = $1`, [tid]);
    }
    await db.query("DELETE FROM public.tenants WHERE id = $1", [tid]);
    await world.cleanup();
  } finally {
    await db.end();
  }
}, 15_000);

describe("insert_effective_record with RESTRICTIVE admin policy", () => {
  it("owner (app_role='owner', is_tenant_admin) can insert via RPC", async () => {
    const client = world.clientFor(ownerToken);
    const { data, error } = await client.rpc("insert_effective_record", {
      p_table: "ec_job_information",
      p_user_id: employeeUserId,
      p_data: { job_title: "Test Job", event_reason: "Test" },
      p_start: "2026-06-01",
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it("employee (app_role='employee', NOT is_tenant_admin) is blocked", async () => {
    const client = world.clientFor(employeeToken);
    const { data, error } = await client.rpc("insert_effective_record", {
      p_table: "ec_job_information",
      p_user_id: employeeUserId,
      p_data: { job_title: "Hack Job", event_reason: "Should fail" },
      p_start: "2026-07-01",
    });
    expect(error).toBeTruthy();
    expect(data).toBeNull();
  });

  it("owner can also insert ec_compensation via RPC", async () => {
    const client = world.clientFor(ownerToken);
    const { data, error } = await client.rpc("insert_effective_record", {
      p_table: "ec_compensation",
      p_user_id: employeeUserId,
      p_data: { base_salary: 50000, currency: "MXN", frequency: "monthly", event_reason: "Hire" },
      p_start: "2026-06-01",
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });
});
