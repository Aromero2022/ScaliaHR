import { describe, it, expect, vi, beforeEach } from "vitest";

const withTenantSpy = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("@/lib/db/tenant-client", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
    raw: (s: string) => s,
  },
  withTenant: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    withTenantSpy();
    const fakeTx = {
      $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    };
    return fn(fakeTx);
  },
}));

vi.mock("@/lib/supabase/claims", () => ({
  getClaims: vi.fn().mockResolvedValue({
    userId: "auth-uid",
    email: "",
    tenantId: "tenant-1",
    appRole: null,
    aal: "aal1" as const,
  }),
}));

// React.cache that actually memoizes by argument identity, like the real one
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => {
      const store = new Map<string, unknown>();
      return ((...args: unknown[]) => {
        const key = JSON.stringify(args);
        if (!store.has(key)) store.set(key, fn(...args));
        return store.get(key)!;
      }) as unknown as T;
    },
  };
});

const { can } = await import("@/lib/authz/can");

const SIDEBAR_KEYS = [
  "ec.view_org_chart",
  "pmgm.view_own_goals",
  "lms.access",
  "tih.employee_skills",
  "arco.manage",
  "admin_center.access",
];

describe("withTenant call count — layout sidebar pattern", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryRaw.mockResolvedValue([{}]);
  });

  it("Promise.all of can() for 6 sidebar keys opens exactly 1 withTenant", async () => {
    const results = await Promise.all(
      SIDEBAR_KEYS.map((key) => can("user-1", key, "view")),
    );
    expect(results).toHaveLength(6);
    // Old code: each can() → evaluateCached(…, permissionKey, …) → different
    // cache key per key → 6 withTenant calls. Fix: loadPermissionContext is
    // cached per (userId, tenantId) → 1 withTenant call.
    expect(withTenantSpy).toHaveBeenCalledTimes(1);
  });
});
