import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

/**
 * anonymize_user(): final, irreversible suppression step of an ARCO
 * cancellation. Personal data disappears everywhere (including earlier audit
 * entries); ids, reporting line and the audit trail of events remain.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

const ORIGINAL = {
  firstName: "Pedro",
  lastName: "Pérezgarcía",
  middleName: "Luisángel",
  email: "pedro.perezgarcia@empresa.test",
  phone: "+52 55 1234 5678",
  personalEmail: "pedro.personal@correo.test",
  nationalId: "PEPL800101HDFRRS09",
  taxId: "PEPL800101AB1",
  address: "Calle Insurgentes 1234",
  emergencyName: "María Pérezgarcía",
  emergencyPhone: "+52 55 8765 4321",
  dateOfBirth: "1980-01-01",
};

// Columns of ec_personal_information that are not personal data.
const NON_PERSONAL_COLUMNS = new Set([
  "id", "tenant_id", "user_id", "start_date", "end_date", "sequence",
  "created_at", "updated_at", "first_name", "last_name",
]);

let tenant: TestTenant;
let otherTenant: TestTenant;
let personalInfoId: string;
let cancelacionId: string;
let accesoId: string;
let auditCountBefore: number;

async function createArcoRequest(type: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.arco_requests (tenant_id, requester_id, subject_id, request_type, description, due_date)
     VALUES ($1, $2, $2, $3, 'Integration fixture', DATE '2026-12-31') RETURNING id`,
    [tenant.id, tenant.employee.userId, type],
  );
  return rows[0].id;
}

beforeAll(async () => {
  tenant = await world.createTenant();
  otherTenant = await world.createTenant();
  const subject = tenant.employee;

  await db.query("UPDATE public.users SET employee_id = 'EMP-IT-001', first_name = $2, last_name = $3, email = $4 WHERE id = $1", [
    subject.userId,
    ORIGINAL.firstName,
    ORIGINAL.lastName,
    ORIGINAL.email,
  ]);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.ec_personal_information (
       tenant_id, user_id, start_date, first_name, last_name, middle_name, date_of_birth, gender,
       marital_status, nationality, phone, personal_email, national_id, tax_id, address_line1,
       address_line2, city, state, postal_code, country, emergency_contact_name,
       emergency_contact_phone, event_reason)
     VALUES ($1, $2, DATE '2026-01-01', $3, $4, $5, $6::date, 'M', 'casado', 'mexicana', $7, $8, $9, $10,
             $11, 'Int 2', 'Ciudad de México', 'CDMX', '01000', 'MX', $12, $13, 'Alta')
     RETURNING id`,
    [
      tenant.id, subject.userId, ORIGINAL.firstName, ORIGINAL.lastName, ORIGINAL.middleName,
      ORIGINAL.dateOfBirth, ORIGINAL.phone, ORIGINAL.personalEmail, ORIGINAL.nationalId,
      ORIGINAL.taxId, ORIGINAL.address, ORIGINAL.emergencyName, ORIGINAL.emergencyPhone,
    ],
  );
  personalInfoId = rows[0].id;

  // Earlier audit entries: one without personal data, one that recorded a profile change.
  await db.query(
    `INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id)
     VALUES ($1, $2, 'it.preexisting', 'users', $3)`,
    [tenant.id, subject.userId, subject.userId],
  );
  await db.query(
    `INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, diff)
     VALUES ($1, $2, 'users.update', 'users', $3, $4::jsonb)`,
    [
      tenant.id,
      tenant.admin.userId,
      subject.userId,
      JSON.stringify({
        before: { first_name: ORIGINAL.firstName, email: ORIGINAL.email, phone: ORIGINAL.phone },
        after: { first_name: ORIGINAL.firstName, email: ORIGINAL.personalEmail },
        reason: `Correction requested by ${ORIGINAL.firstName} ${ORIGINAL.lastName}`,
        department: "Finance",
      }),
    ],
  );

  cancelacionId = await createArcoRequest("cancelacion");
  accesoId = await createArcoRequest("acceso");

  const { rows: count } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1",
    [tenant.id],
  );
  auditCountBefore = count[0].n;
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

describe("anonymize_user() — preconditions", () => {
  it("is rejected for callers that are not tenant admins", async () => {
    const { error } = await tenant.manager.client.rpc("anonymize_user", {
      p_user_id: tenant.employee.userId,
      p_arco_request_id: cancelacionId,
    });
    expect(error?.message).toContain("Only tenant admins");
  });

  it("is rejected for admins of another tenant", async () => {
    const { error } = await otherTenant.admin.client.rpc("anonymize_user", {
      p_user_id: tenant.employee.userId,
      p_arco_request_id: cancelacionId,
    });
    expect(error?.message).toContain("User not found in tenant");
  });

  it("requires a cancelacion request for that user", async () => {
    const { error } = await tenant.admin.client.rpc("anonymize_user", {
      p_user_id: tenant.employee.userId,
      p_arco_request_id: accesoId,
    });
    expect(error?.message).toContain("cancelacion ARCO request");
  });
});

describe("anonymize_user() — suppression", () => {
  it("runs for a tenant admin and returns no personal data", async () => {
    const { data, error } = await tenant.admin.client.rpc("anonymize_user", {
      p_user_id: tenant.employee.userId,
      p_arco_request_id: cancelacionId,
    });
    expect(error).toBeNull();
    expect(Object.keys(data as object).sort()).toEqual(["anonymized_at", "arco_request_id", "user_id"]);
    expect(data).toMatchObject({ user_id: tenant.employee.userId, arco_request_id: cancelacionId });
  });

  it("replaces the user's personal data and keeps the identifiers", async () => {
    const { rows } = await db.query(
      `SELECT id, tenant_id, auth_uid, employee_id, first_name, last_name, email,
              is_anonymized, status, deleted_at
       FROM public.users WHERE id = $1`,
      [tenant.employee.userId],
    );
    const user = rows[0];
    expect(user.tenant_id).toBe(tenant.id);
    expect(user.auth_uid).toBe(tenant.employee.authId);
    expect(user.employee_id).toBe("EMP-IT-001");
    expect(user.first_name).toMatch(/^ANON-[0-9a-f]{8}$/);
    expect(user.last_name).toBe("ANONIMIZADO");
    expect(user.email).toBe(`${user.first_name}@removed.local`);
    expect(user.is_anonymized).toBe(true);
    expect(user.status).toBe("TERMINATED");
    expect(user.deleted_at).not.toBeNull();
  });

  it("clears every personal column of ec_personal_information and keeps the record", async () => {
    const { rows } = await db.query("SELECT * FROM public.ec_personal_information WHERE user_id = $1", [
      tenant.employee.userId,
    ]);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe(personalInfoId);
    expect(row.first_name).toMatch(/^ANON-[0-9a-f]{8}$/);
    expect(row.last_name).toBe("ANONIMIZADO");
    const leftovers = Object.entries(row).filter(
      ([column, value]) => !NON_PERSONAL_COLUMNS.has(column) && value !== null,
    );
    expect(leftovers).toEqual([]);
  });

  it("keeps the reporting line", async () => {
    const { rows } = await db.query(
      "SELECT manager_id FROM public.ec_job_information WHERE user_id = $1 AND end_date IS NULL",
      [tenant.employee.userId],
    );
    expect(rows).toEqual([{ manager_id: tenant.manager.userId }]);
  });

  it("logs only the event: actor, time, user id and ARCO request id", async () => {
    const { rows } = await db.query(
      `SELECT user_id, entity, entity_id, diff, details_json, created_at FROM public.audit_logs
       WHERE tenant_id = $1 AND action = 'arco.anonymize'`,
      [tenant.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: tenant.admin.userId,
      entity: "users",
      entity_id: tenant.employee.userId,
      diff: { arco_request_id: cancelacionId },
      details_json: null,
    });
    expect(rows[0].created_at).not.toBeNull();
  });

  it("keeps every earlier audit entry", async () => {
    const { rows } = await db.query<{ action: string; n: number }>(
      "SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1",
      [tenant.id],
    );
    expect(rows[0].n).toBe(auditCountBefore + 1);
    const { rows: kept } = await db.query<{ action: string; diff: Record<string, unknown> | null }>(
      `SELECT action, diff FROM public.audit_logs
       WHERE tenant_id = $1 AND action IN ('it.preexisting', 'users.update') ORDER BY action`,
      [tenant.id],
    );
    expect(kept.map((r) => r.action)).toEqual(["it.preexisting", "users.update"]);
    expect(kept[1].diff).toMatchObject({ department: "Finance" });
  });

  it("leaves no original personal value anywhere in audit_logs", async () => {
    const { rows } = await db.query<{ row: string }>(
      "SELECT row_to_json(al)::text AS row FROM public.audit_logs al WHERE tenant_id = $1",
      [tenant.id],
    );
    const dump = rows.map((r) => r.row).join("\n").toLowerCase();
    for (const value of Object.values(ORIGINAL)) {
      expect(dump, `audit_logs still contains "${value}"`).not.toContain(value.toLowerCase());
    }
  });

  it("cannot run twice on the same user", async () => {
    const { error } = await tenant.admin.client.rpc("anonymize_user", {
      p_user_id: tenant.employee.userId,
      p_arco_request_id: cancelacionId,
    });
    expect(error?.message).toContain("already anonymized");
  });
});
