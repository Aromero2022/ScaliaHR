import { describe, expect, it } from "vitest";
import { TENANT_ACCESS_TTL_MS, memoryTenantAccessCache, tenantAccessKey } from "@/lib/tenant/access-cache";

/** D35: the middleware's tenant check, remembered for a few seconds per (requested, token) pair. */
describe("memoryTenantAccessCache (D35)", () => {
  it("answers for TTL and then forgets", () => {
    let now = 1_000;
    const cache = memoryTenantAccessCache(TENANT_ACCESS_TTL_MS, () => now);
    const key = tenantAccessKey("acme-corp", "t1");
    cache.set(key, true);
    expect(cache.get(key)).toBe(true);
    now += TENANT_ACCESS_TTL_MS - 1;
    expect(cache.get(key)).toBe(true);
    now += 1;
    expect(cache.get(key)).toBeUndefined();
  });

  it("keys by requested tenant and token tenant, so one never answers for another", () => {
    const cache = memoryTenantAccessCache();
    cache.set(tenantAccessKey("acme-corp", "t1"), true);
    expect(cache.get(tenantAccessKey("acme-corp", "t2"))).toBeUndefined();
    expect(cache.get(tenantAccessKey("other", "t1"))).toBeUndefined();
    expect(cache.get(tenantAccessKey(null, "t1"))).toBeUndefined();
  });

  it("invalidate drops every entry of that tenant and nothing else", () => {
    const cache = memoryTenantAccessCache();
    cache.set(tenantAccessKey("acme-corp", "t1"), true);
    cache.set(tenantAccessKey(null, "t1"), true);
    cache.set(tenantAccessKey("beta", "t2"), true);
    cache.invalidate("t1");
    expect(cache.get(tenantAccessKey("acme-corp", "t1"))).toBeUndefined();
    expect(cache.get(tenantAccessKey(null, "t1"))).toBeUndefined();
    expect(cache.get(tenantAccessKey("beta", "t2"))).toBe(true);
  });
});
