import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

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

let tenant: TestTenant;

function claimsFor(tenantId: string) {
  mockGetClaims.mockResolvedValue({
    userId: "auth-uid",
    email: "",
    tenantId,
    appRole: null,
    aal: "aal1" as const,
  });
}

beforeAll(async () => {
  tenant = await world.createTenant();
});

beforeEach(() => {
  vi.clearAllMocks();
  claimsFor(tenant?.id ?? "unknown");
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
    await prisma.$disconnect();
  }
});

describe("revoked grant — can() reflects removal immediately", () => {
  it("admin has admin_center.access, loses it after group_members removal, regains it on restore", async () => {
    const result1 = await can(tenant.admin.userId, "admin_center.access", "view");
    expect(result1).toEqual({ allowed: true });

    await db.query(
      "DELETE FROM public.group_members WHERE tenant_id = $1 AND group_id = $2 AND user_id = $3",
      [tenant.id, tenant.adminGroupId, tenant.admin.userId],
    );

    try {
      const result2 = await can(tenant.admin.userId, "admin_center.access", "view");
      expect(result2.allowed).toBe(false);
      expect(result2.reason).toBe("no_group_membership");
    } finally {
      await db.query(
        "INSERT INTO public.group_members (tenant_id, group_id, user_id) VALUES ($1, $2, $3)",
        [tenant.id, tenant.adminGroupId, tenant.admin.userId],
      );
    }

    const result3 = await can(tenant.admin.userId, "admin_center.access", "view");
    expect(result3).toEqual({ allowed: true });
  });

  it("employee has employee_profile:view via self-grant, loses it after group removal", async () => {
    const result1 = await can(
      tenant.employee.userId,
      "employee_profile",
      "view",
      tenant.employee.userId,
    );
    expect(result1).toEqual({ allowed: true });

    await db.query(
      "DELETE FROM public.group_members WHERE tenant_id = $1 AND group_id = $2 AND user_id = $3",
      [tenant.id, tenant.employeeGroupId, tenant.employee.userId],
    );

    try {
      const result2 = await can(
        tenant.employee.userId,
        "employee_profile",
        "view",
        tenant.employee.userId,
      );
      expect(result2.allowed).toBe(false);
      expect(result2.reason).toBe("no_group_membership");
    } finally {
      await db.query(
        "INSERT INTO public.group_members (tenant_id, group_id, user_id) VALUES ($1, $2, $3)",
        [tenant.id, tenant.employeeGroupId, tenant.employee.userId],
      );
    }
  });
});
