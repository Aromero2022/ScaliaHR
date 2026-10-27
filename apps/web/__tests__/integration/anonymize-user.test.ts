import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

/**
 * anonymize_user() (ARCO cancellation) against the real schema: PII is
 * replaced, identifiers, reporting line and audit history are kept.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

let tenant: TestTenant;
let otherTenant: TestTenant;
let personalInfoId: string;
let token: string;

beforeAll(async () => {
  tenant = await world.createTenant();
  otherTenant = await world.createTenant();
  const subject = tenant.employee;

  await db.query("UPDATE public.users SET employee_id = 'EMP-IT-001' WHERE id = $1", [subject.userId]);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.ec_personal_information (
       tenant_id, user_id, start_date, first_name, last_name, middle_name, phone, personal_email,
       national_id, tax_id, address_line1, address_line2, city, state, postal_code,
       emergency_contact_name, emergency_contact_phone)
     VALUES ($1, $2, DATE '2026-01-01', 'Pedro', 'Pérez', 'Luis', '+52 55 1234 5678', 'pedro@personal.test',
             'PEPL800101HDFRRS09', 'PEPL800101AB1', 'Calle 1', 'Int 2', 'CDMX', 'CDMX', '01000',
             'María Pérez', '+52 55 8765 4321')
     RETURNING id`,
    [tenant.id, subject.userId],
  );
  personalInfoId = rows[0].id;
  await db.query(
    `INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id)
     VALUES ($1, $2, 'it.preexisting', 'users', $2::text)`,
    [tenant.id, subject.userId],
  );
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

describe("anonymize_user()", () => {
  it("is rejected for callers that are not tenant admins", async () => {
    const { error } = await tenant.manager.client.rpc("anonymize_user", { p_user_id: tenant.employee.userId });
    expect(error?.message).toContain("Only tenant admins");
  });

  it("is rejected for admins of another tenant", async () => {
    const { error } = await otherTenant.admin.client.rpc("anonymize_user", {
      p_user_id: tenant.employee.userId,
    });
    expect(error?.message).toContain("User not found in tenant");
  });

  it("runs for a tenant admin", async () => {
    const { data, error } = await tenant.admin.client.rpc("anonymize_user", {
      p_user_id: tenant.employee.userId,
    });
    expect(error).toBeNull();
    token = (data as { token: string }).token;
    expect(token).toMatch(/^ANON-[0-9a-f]{8}$/);
  });

  it("replaces the user's PII and keeps the identifiers", async () => {
    const { rows } = await db.query(
      `SELECT id, tenant_id, auth_uid, employee_id, first_name, last_name, email,
              is_anonymized, status, deleted_at
       FROM public.users WHERE id = $1`,
      [tenant.employee.userId],
    );
    expect(rows).toHaveLength(1);
    const user = rows[0];
    expect(user.tenant_id).toBe(tenant.id);
    expect(user.auth_uid).toBe(tenant.employee.authId);
    expect(user.employee_id).toBe("EMP-IT-001");
    expect(user.first_name).toBe(token);
    expect(user.last_name).toBe("ANONIMIZADO");
    expect(user.email).toBe(`${token}@removed.local`);
    expect(user.is_anonymized).toBe(true);
    expect(user.status).toBe("TERMINATED");
    expect(user.deleted_at).not.toBeNull();
  });

  it("replaces the personal information and keeps the record", async () => {
    const { rows } = await db.query(
      `SELECT id, user_id, first_name, last_name, middle_name, phone, personal_email, national_id,
              tax_id, address_line1, address_line2, city, state, postal_code,
              emergency_contact_name, emergency_contact_phone
       FROM public.ec_personal_information WHERE user_id = $1`,
      [tenant.employee.userId],
    );
    expect(rows).toEqual([
      {
        id: personalInfoId,
        user_id: tenant.employee.userId,
        first_name: token,
        last_name: "ANONIMIZADO",
        middle_name: null,
        phone: null,
        personal_email: null,
        national_id: null,
        tax_id: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        postal_code: null,
        emergency_contact_name: null,
        emergency_contact_phone: null,
      },
    ]);
  });

  it("keeps the reporting line", async () => {
    const { rows } = await db.query(
      "SELECT manager_id FROM public.ec_job_information WHERE user_id = $1 AND end_date IS NULL",
      [tenant.employee.userId],
    );
    expect(rows).toEqual([{ manager_id: tenant.manager.userId }]);
  });

  it("keeps earlier audit entries and records the anonymization", async () => {
    const { rows } = await db.query<{ action: string; user_id: string }>(
      `SELECT action, user_id FROM public.audit_logs
       WHERE tenant_id = $1 AND entity = 'users' AND entity_id = $2 ORDER BY created_at`,
      [tenant.id, tenant.employee.userId],
    );
    expect(rows.map((r) => r.action)).toEqual(["it.preexisting", "arco.anonymize"]);
    expect(rows[0].user_id).toBe(tenant.employee.userId);
    expect(rows[1].user_id).toBe(tenant.admin.userId);
  });
});
