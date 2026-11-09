import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant, type TestUser } from "./helpers/world";

/**
 * D45 — the employee detail against the local database: the job section reads
 * business unit and legal entity through the record's department, under the
 * caller's RLS; a query that fails shows its error with the request id, not
 * "Sin información laboral registrada". The page is rendered with the real
 * Supabase client of the signed-in person; only the session plumbing (claims,
 * module flags, can(), time zone) is stubbed.
 */

const forwardedHeaders = new Map<string, string>([["x-request-id", "req-d45-it"]]);
vi.mock("next/headers", () => ({ headers: vi.fn(async () => forwardedHeaders) }));

const session = vi.hoisted(() => ({ client: null as unknown, authId: "", tenantId: "" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
vi.mock("@/lib/supabase/claims", () => {
  const claims = async () => ({ userId: session.authId, email: "", tenantId: session.tenantId, appRole: "owner", aal: "aal2" });
  return { getClaims: claims, requireAuth: claims };
});
vi.mock("@/lib/tenant/get-module-flags", () => ({ getModuleFlags: async () => ({ is_ec_active: true }) }));
vi.mock("@/lib/authz/can", () => ({ can: async () => ({ allowed: true }) }));
vi.mock("@/lib/tenant/get-tenant-time-zone", () => ({ getTenantTimeZone: async () => ({ timeZone: "America/Mexico_City", isFallback: false }) }));
vi.mock("@/lib/rate-limit", () => ({ limitRead: async () => null, limitWrite: async () => null }));
vi.mock("@/lib/audit/log", () => ({ writeAuditLog: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const env = integrationEnv();
const { JOB_INFORMATION_SELECT, jobOrganization } = await import("@/lib/employees/job-information");
const { default: EmployeeDetailPage } = await import("@/app/(protected)/employees/[id]/page");

const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);
let tenant: TestTenant;
let other: TestTenant;

const ORG = { department: "Integración D45", businessUnit: "División Integración", legalEntity: "Integración S.A. de C.V." };

/** The same client, except that ec_job_information is read with the embed this PR removes (PostgREST answers PGRST200). */
function withBrokenJobSelect(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== "from") return Reflect.get(target, prop, receiver);
      return (table: string) => {
        const builder = target.from(table);
        if (table !== "ec_job_information") return builder;
        return { select: () => builder.select("*, business_units(name), legal_entities(name)") };
      };
    },
  });
}

async function renderDetail(as: TestUser, employeeId: string, client: SupabaseClient = as.client): Promise<string> {
  session.client = client;
  session.authId = as.authId;
  session.tenantId = tenant.id;
  return renderToStaticMarkup(await EmployeeDetailPage({ params: Promise.resolve({ id: employeeId }) }));
}

beforeAll(async () => {
  tenant = await world.createTenant();
  other = await world.createTenant();
  const legalEntity = randomUUID();
  const businessUnit = randomUUID();
  const department = randomUUID();
  await db.query("INSERT INTO public.legal_entities (id, tenant_id, code, name) VALUES ($1, $2, 'LE-IT', $3)", [legalEntity, tenant.id, ORG.legalEntity]);
  await db.query("INSERT INTO public.business_units (id, tenant_id, code, name, legal_entity_id) VALUES ($1, $2, 'BU-IT', $3, $4)", [
    businessUnit,
    tenant.id,
    ORG.businessUnit,
    legalEntity,
  ]);
  await db.query("INSERT INTO public.departments (id, tenant_id, name, business_unit_id, legal_entity_id) VALUES ($1, $2, $3, $4, $5)", [
    department,
    tenant.id,
    ORG.department,
    businessUnit,
    legalEntity,
  ]);
  await db.query("UPDATE public.ec_job_information SET department_id = $1 WHERE tenant_id = $2 AND user_id = $3", [department, tenant.id, tenant.employee.userId]);
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

describe("employee job information (D45)", () => {
  it("the old embed is what failed: ec_job_information has no relation to business_units", async () => {
    const { data, error } = await tenant.admin.client
      .from("ec_job_information")
      .select("*, business_units(name), legal_entities(name)")
      .eq("user_id", tenant.employee.userId);
    expect(data).toBeNull();
    expect(error?.code).toBe("PGRST200");
  });

  it("an admin reads the employee's job with business unit and legal entity from the department", async () => {
    const { data, error } = await tenant.admin.client
      .from("ec_job_information")
      .select(JOB_INFORMATION_SELECT)
      .eq("user_id", tenant.employee.userId)
      .is("end_date", null)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toMatchObject({ job_title: "Analyst" });
    expect(jobOrganization(data!)).toEqual(ORG);
  });

  it("the admin's detail page shows the job with them", async () => {
    const html = await renderDetail(tenant.admin, tenant.employee.userId);
    expect(html).toContain("Analyst");
    for (const name of Object.values(ORG)) expect(html).toContain(name);
    expect(html).not.toContain("Sin información laboral registrada");
  });

  it("a job query that fails shows its error with the request id, not an empty section, and logs the detail", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await renderDetail(tenant.admin, tenant.employee.userId, withBrokenJobSelect(tenant.admin.client));
    const lines = err.mock.calls.map((args) => JSON.parse(String(args[0])) as Record<string, unknown>);
    err.mockRestore();

    expect(html).toContain("No se pudo cargar esta información. Código: req-d45-it");
    expect(html).not.toContain("Sin información laboral registrada");
    expect(html).not.toContain("PGRST200");
    // The other sections are independent: the personal one still answers (this employee has no record yet).
    expect(html).toContain("Sin información personal registrada.");
    expect(lines).toContainEqual(
      expect.objectContaining({ level: "error", event: "employee_detail.job", requestId: "req-d45-it", error: expect.objectContaining({ code: "PGRST200" }) }),
    );
  });

  it("an employee reads their own job under RLS, with business unit and legal entity", async () => {
    const { data, error } = await tenant.employee.client
      .from("ec_job_information")
      .select(JOB_INFORMATION_SELECT)
      .eq("user_id", tenant.employee.userId)
      .is("end_date", null)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toMatchObject({ job_title: "Analyst" });
    expect(jobOrganization(data!)).toEqual(ORG);
  });

  it("an employee does not see another tenant's job: no rows, not an error", async () => {
    const { data, error } = await tenant.employee.client
      .from("ec_job_information")
      .select(JOB_INFORMATION_SELECT)
      .eq("user_id", other.employee.userId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
