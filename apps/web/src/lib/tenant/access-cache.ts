// D35 — the middleware's tenant check (D21) answered from memory for a few
// seconds. Every request used to look the tenant up; now one lookup per
// (requested tenant, token tenant) pair serves that pair for TTL_MS. A tenant
// suspended in the database is refused at the latest TTL_MS later; new tokens
// leave it out at once (custom_access_token_hook, D21). The interface is the
// one a shared store (Redis, Phase 23) would implement, so `invalidate` can
// reach every instance there; in memory it reaches this process only.

export const TENANT_ACCESS_TTL_MS = 5_000;
const MAX_ENTRIES = 10_000;

export interface TenantAccessCache {
  get(key: string): boolean | undefined;
  set(key: string, allowed: boolean): void;
  /** Drops every entry for a tenant, e.g. right after suspending it. */
  invalidate(tenantId: string): void;
}

type Entry = { allowed: boolean; tenantId: string; expires: number };

export function memoryTenantAccessCache(ttlMs = TENANT_ACCESS_TTL_MS, now: () => number = Date.now): TenantAccessCache {
  const entries = new Map<string, Entry>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.allowed;
    },
    set(key, allowed) {
      if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
      entries.set(key, { allowed, tenantId: key.split("|")[1], expires: now() + ttlMs });
    },
    invalidate(tenantId) {
      for (const [key, entry] of entries) if (entry.tenantId === tenantId) entries.delete(key);
    },
  };
}

/** Cache key: the tenant the request asks for and the tenant in the verified token. */
export function tenantAccessKey(requested: string | null, tokenTenantId: string): string {
  return `${requested ?? ""}|${tokenTenantId}`;
}

let shared: TenantAccessCache = memoryTenantAccessCache();

export function tenantAccessCache(): TenantAccessCache {
  return shared;
}

/** Tests swap the cache (or a Redis-backed one is plugged in, Phase 23). */
export function setTenantAccessCache(next: TenantAccessCache): void {
  shared = next;
}
