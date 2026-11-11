import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

/**
 * 9c PR 6c — ⌘K opens the employee list on one person by id
 * (`/employees?person=<uuid>`), never by email. Rendered against the local
 * database with the real Supabase client of the signed-in admin; only the
 * session plumbing (claims, module flags, can()) and the router are stubbed.
 * The id is a guid read inside the caller's tenant: another tenant's person
 * and an invalid value show "No se encontró a esa persona", never anyone.
 */

const session = vi.hoisted(() => ({ client: null as unknown, authId: "", tenantId: "" }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Map([["x-request-id", "req-6c-it"]])) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
vi.mock("@/lib/supabase/claims", () => {
  const claims = async () => ({ userId: session.authId, email: "", tenantId: session.tenantId, appRole: "owner", aal: "aal2" });
  return { getClaims: claims, requireAuth: claims };
});
vi.mock("@/lib/tenant/get-module-flags", () => ({ getModuleFlags: async () => ({ is_ec_active: true }) }));
vi.mock("@/lib/authz/can", () => ({ can: async () => ({ allowed: true }) }));
vi.mock("next/navigation", async () => ({
  ...(await vi.importActual<typeof import("next/navigation")>("next/navigation")),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/employees",
  useSearchParams: () => new URLSearchParams(),
}));

const env = integrationEnv();
const { default: EmployeesPage } = await import("@/app/(protected)/employees/page");

const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);
let tenant: TestTenant;
let other: TestTenant;

async function renderList(params: Record<string, string | string[]>): Promise<string> {
  session.client = tenant.admin.client;
  session.authId = tenant.admin.authId;
  session.tenantId = tenant.id;
  return renderToStaticMarkup(await EmployeesPage({ searchParams: Promise.resolve(params) }));
}

beforeAll(async () => {
  tenant = await world.createTenant();
  other = await world.createTenant();
  // The directory reads names, titles and departments with ec.view_org_chart (D47).
  await db.query("INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action) VALUES ($1, $2, 'ec.view_org_chart', 'view')", [
    tenant.id,
    tenant.adminRoleId,
  ]);
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

describe("the employee list opened on one person by id (9c PR 6c)", () => {
  it("control: without a filter the list shows the tenant's people", async () => {
    const html = await renderList({});
    for (const user of [tenant.admin, tenant.manager, tenant.employee]) expect(html).toContain(user.email);
    expect(html).not.toContain(other.employee.email);
  });

  it("a person of the tenant: only that person, with the filter notice", async () => {
    const html = await renderList({ person: tenant.employee.userId });
    expect(html).toContain(tenant.employee.email);
    expect(html).not.toContain(tenant.manager.email);
    expect(html).not.toContain(tenant.admin.email);
    expect(html).toContain("Filtrado por persona");
    expect(html).toContain("Quitar filtro");
  });

  it("a person of another tenant: no one", async () => {
    const html = await renderList({ person: other.employee.userId });
    expect(html).not.toContain(other.employee.email);
    for (const user of [tenant.admin, tenant.manager, tenant.employee]) expect(html).not.toContain(user.email);
    expect(html).toContain("No se encontró a esa persona.");
  });

  it("an invalid value or an email: no one, never the whole list", async () => {
    for (const person of ["not-a-guid", tenant.employee.email, [tenant.employee.userId, tenant.manager.userId]]) {
      const html = await renderList({ person });
      for (const user of [tenant.admin, tenant.manager, tenant.employee]) expect(html, JSON.stringify(person)).not.toContain(user.email);
      expect(html).toContain("No se encontró a esa persona.");
    }
  });

  it("the person filter wins over a search, so a search cannot widen it", async () => {
    const html = await renderList({ person: tenant.employee.userId, q: "manager" });
    expect(html).toContain(tenant.employee.email);
    expect(html).not.toContain(tenant.manager.email);
  });
});
