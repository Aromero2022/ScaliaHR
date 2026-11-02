import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

const env = integrationEnv();

// Use connection_limit=1 to reproduce the pool exhaustion bug.
// The default .env.example may use a higher limit, but the layout's
// Promise.all of N can() calls can exceed any reasonable pool size.
const prismaUrl = new URL(env.prismaDbUrl);
prismaUrl.searchParams.set("connection_limit", "1");
process.env.DATABASE_URL = prismaUrl.toString();

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

const SIDEBAR_KEYS = [
  "ec.view_org_chart",
  "pmgm.view_own_goals",
  "lms.access",
  "tih.employee_skills",
  "arco.manage",
  "admin_center.access",
];

beforeAll(async () => {
  tenant = await world.createTenant();
}, 30_000);

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
}, 15_000);

describe("can() pool exhaustion (layout pattern)", () => {
  it("parallel can() for all sidebar keys completes without pool timeout", async () => {
    const results = await Promise.all(
      SIDEBAR_KEYS.map((key) => can(tenant.admin.userId, key, "view")),
    );
    expect(results).toHaveLength(SIDEBAR_KEYS.length);
    for (const r of results) {
      expect(r).toHaveProperty("allowed");
    }
  }, 10_000);

  it("sequential can() calls also work (baseline)", async () => {
    for (const key of SIDEBAR_KEYS) {
      const result = await can(tenant.admin.userId, key, "view");
      expect(result).toHaveProperty("allowed");
    }
  }, 10_000);
});
