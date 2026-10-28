import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant, type TestUser } from "./helpers/world";

/**
 * write_audit_log() records the caller's own tenant and actor whatever it is
 * passed, and audit_logs only accepts writes through it.
 * insert_effective_record() works on a closed list of tables, only for the
 * owner or hr_admin of the subject's tenant.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

let tenant: TestTenant;
let otherTenant: TestTenant;
let owner: TestUser;
let hrAdmin: TestUser;
let rbpAdmin: TestUser;
let otherOwner: TestUser;

beforeAll(async () => {
  tenant = await world.createTenant();
  otherTenant = await world.createTenant();
  owner = await world.addMember(tenant.id, "owner");
  hrAdmin = await world.addMember(tenant.id, "hr_admin");
  rbpAdmin = await world.addMember(tenant.id, "employee");
  await db.query(
    `INSERT INTO public.group_members (tenant_id, group_id, user_id)
     VALUES ($1, $2, $3)`,
    [tenant.id, tenant.adminGroupId, rbpAdmin.userId],
  );
  otherOwner = await world.addMember(otherTenant.id, "owner");
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

describe("write_audit_log()", () => {
  it("records the caller's tenant and user, ignoring forged parameters", async () => {
    const { data: id, error } = await tenant.employee.client.rpc("write_audit_log", {
      p_tenant_id: otherTenant.id,
      p_actor_id: otherTenant.admin.userId,
      p_action: "it.forged_actor",
    });
    expect(error).toBeNull();
    const { rows } = await db.query("SELECT tenant_id, user_id FROM public.audit_logs WHERE id = $1", [id]);
    expect(rows).toEqual([{ tenant_id: tenant.id, user_id: tenant.employee.userId }]);

    const { rows: forged } = await db.query(
      "SELECT 1 FROM public.audit_logs WHERE action = 'it.forged_actor' AND (tenant_id = $1 OR user_id = $2)",
      [otherTenant.id, otherTenant.admin.userId],
    );
    expect(forged).toEqual([]);
  });

  it("cannot be used by a signed-in user without tenant", async () => {
    const noTenant = await world.userWithoutTenant();
    const { error } = await noTenant.client.rpc("write_audit_log", {
      p_tenant_id: tenant.id,
      p_actor_id: tenant.employee.userId,
      p_action: "it.no_tenant",
    });
    expect(error?.code).toBe("42501");
  });

  it("rejects direct inserts into audit_logs", async () => {
    const { error } = await tenant.employee.client.from("audit_logs").insert({
      tenant_id: tenant.id,
      user_id: tenant.manager.userId,
      action: "it.direct_insert",
    });
    expect(error?.code).toBe("42501");
    const { rows } = await db.query("SELECT 1 FROM public.audit_logs WHERE action = 'it.direct_insert'");
    expect(rows).toEqual([]);
  });
});

describe("insert_effective_record()", () => {
  it("rejects tables outside the allowed list", async () => {
    for (const table of ["users", "audit_logs", "ec_job_information; DROP TABLE public.users"]) {
      const { error } = await owner.client.rpc("insert_effective_record", {
        p_table: table,
        p_user_id: tenant.employee.userId,
        p_data: {},
      });
      expect(error?.message, table).toContain("Invalid table");
    }
  });

  it("cannot be used by employees, managers or RBP admins without owner/hr_admin role", async () => {
    for (const user of [tenant.employee, tenant.manager, rbpAdmin]) {
      const { error } = await user.client.rpc("insert_effective_record", {
        p_table: "ec_compensation",
        p_user_id: tenant.employee.userId,
        p_data: { base_salary: 1 },
      });
      expect(error?.code).toBe("42501");
    }
    const { rows } = await db.query("SELECT 1 FROM public.ec_compensation WHERE user_id = $1", [
      tenant.employee.userId,
    ]);
    expect(rows).toEqual([]);
  });

  it("rejects subjects from another tenant", async () => {
    const { error } = await otherOwner.client.rpc("insert_effective_record", {
      p_table: "ec_compensation",
      p_user_id: tenant.employee.userId,
      p_data: { base_salary: 1 },
    });
    expect(error?.code).toBe("42501");
  });

  it("rejects protected or unknown columns in p_data", async () => {
    for (const data of [{ tenant_id: otherTenant.id }, { user_id: owner.userId }, { not_a_column: 1 }]) {
      const { error } = await owner.client.rpc("insert_effective_record", {
        p_table: "ec_compensation",
        p_user_id: tenant.employee.userId,
        p_data: { base_salary: 1, ...data },
      });
      expect(error?.message, JSON.stringify(data)).toContain("Columns not allowed");
    }
  });

  it("lets the owner record a change: closes the open row and inserts in the tenant", async () => {
    const { error } = await owner.client.rpc("insert_effective_record", {
      p_table: "ec_job_information",
      p_user_id: tenant.employee.userId,
      p_data: { job_title: "Senior Analyst", manager_id: tenant.manager.userId },
      p_start: "2026-06-01",
    });
    expect(error).toBeNull();
    const { rows } = await db.query(
      `SELECT tenant_id, job_title, start_date::text, end_date::text
       FROM public.ec_job_information WHERE user_id = $1 ORDER BY start_date`,
      [tenant.employee.userId],
    );
    expect(rows).toEqual([
      { tenant_id: tenant.id, job_title: "Analyst", start_date: "2026-01-01", end_date: "2026-06-01" },
      { tenant_id: tenant.id, job_title: "Senior Analyst", start_date: "2026-06-01", end_date: null },
    ]);
  });

  it("lets hr_admin record a compensation change", async () => {
    const { data, error } = await hrAdmin.client.rpc("insert_effective_record", {
      p_table: "ec_compensation",
      p_user_id: tenant.employee.userId,
      p_data: { base_salary: 25000, currency: "MXN", frequency: "monthly" },
      p_start: "2026-06-01",
    });
    expect(error).toBeNull();
    const { rows } = await db.query("SELECT tenant_id, base_salary::text FROM public.ec_compensation WHERE id = $1", [
      data,
    ]);
    expect(rows).toEqual([{ tenant_id: tenant.id, base_salary: "25000.00" }]);
  });
});
