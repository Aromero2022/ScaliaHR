import { beforeEach, describe, expect, it, vi } from "vitest";

/** D42: the tenant's time zone, validated, cached per tenant under its own tag, with a fallback. */

const queryRaw = vi.fn();
vi.mock("@/lib/db/tenant-client", () => ({ prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) } }));

const cacheCalls: { keyParts: string[]; options: { tags?: string[]; revalidate?: number } }[] = [];
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown, keyParts: string[], options: { tags?: string[]; revalidate?: number }) => {
    cacheCalls.push({ keyParts, options });
    return fn;
  },
}));

const requireAuth = vi.fn();
vi.mock("@/lib/supabase/claims", () => ({ requireAuth: () => requireAuth() }));

const {
  TENANT_TIME_ZONE_FALLBACK,
  getSessionTimeZone,
  getTenantTimeZone,
  readTenantTimeZone,
  tenantTimeZoneTag,
  toTenantTimeZone,
} = await import("@/lib/tenant/get-tenant-time-zone");

const TENANT = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  queryRaw.mockReset();
  requireAuth.mockReset();
  cacheCalls.length = 0;
});

describe("tenant time zone (D42)", () => {
  it("accepts an IANA zone, in its canonical name", () => {
    expect(toTenantTimeZone("America/Monterrey")).toEqual({ timeZone: "America/Monterrey", isFallback: false });
    expect(toTenantTimeZone("america/mexico_city")).toEqual({ timeZone: "America/Mexico_City", isFallback: false });
  });

  it.each([null, undefined, "", "Mars/Olympus", "+01:00", 42, { zone: "UTC" }])("falls back to America/Mexico_City for %j", (raw) => {
    expect(toTenantTimeZone(raw)).toEqual({ timeZone: "America/Mexico_City", isFallback: true });
  });

  it("reads one tenant through public.tenant_time_zone()", async () => {
    queryRaw.mockResolvedValueOnce([{ time_zone: "America/Cancun" }]);
    expect(await readTenantTimeZone(TENANT)).toEqual({ timeZone: "America/Cancun", isFallback: false });
    const [strings, tenantId] = queryRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(strings.join("?")).toMatch(/SELECT public\.tenant_time_zone\(\?::uuid\) AS time_zone/);
    expect(tenantId).toBe(TENANT);
  });

  it("caches per tenant under tenantTimeZoneTag(id), so Phase 11 can revalidate it", async () => {
    queryRaw.mockResolvedValueOnce([{ time_zone: null }]);
    expect(tenantTimeZoneTag(TENANT)).toBe(`tenant:${TENANT}:time-zone`);
    expect(await getTenantTimeZone(TENANT)).toEqual({ timeZone: TENANT_TIME_ZONE_FALLBACK, isFallback: true });
    expect(cacheCalls).toEqual([{ keyParts: ["tenant-time-zone", TENANT], options: { tags: [`tenant:${TENANT}:time-zone`], revalidate: 60 } }]);
  });

  it("takes the tenant from the verified token, and falls back without one", async () => {
    queryRaw.mockResolvedValueOnce([{ time_zone: "Asia/Tokyo" }]);
    requireAuth.mockResolvedValueOnce({ tenantId: TENANT });
    expect(await getSessionTimeZone()).toBe("Asia/Tokyo");
    expect(queryRaw.mock.calls[0][1]).toBe(TENANT);

    requireAuth.mockResolvedValueOnce({ tenantId: null });
    expect(await getSessionTimeZone()).toBe("America/Mexico_City");
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
