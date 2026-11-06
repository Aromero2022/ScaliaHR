import { cache } from "react";
import { unstable_cache } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db/tenant-client";
import { requireAuth } from "@/lib/supabase/claims";
import { canonicalTimeZone } from "@/lib/format/dates";
import { DEFAULT_TENANT_TIME_ZONE } from "./platform-defaults";

// D42: the tenant's time zone (system_configurations key platform.timezone),
// read through public.tenant_time_zone(), which only prisma_app can run: the
// SELECT policy of system_configurations is for tenant admins, and the cache
// is filled outside any request. Cached per tenant like the module flags
// (D35); the Admin Center revalidates tenantTimeZoneTag(id) when the zone is
// edited (Phase 11). The tenant id always comes from the server: the verified
// token (getSessionTimeZone) or the subdomain, never from user input.

export const TENANT_TIME_ZONE_FALLBACK = DEFAULT_TENANT_TIME_ZONE;
export const TENANT_TIME_ZONE_REVALIDATE_SECONDS = 60;

export function tenantTimeZoneTag(tenantId: string): string {
  return `tenant:${tenantId}:time-zone`;
}

export type TenantTimeZone = { timeZone: string; isFallback: boolean };

const TimeZoneName = z.string().transform((value, ctx) => {
  const zone = canonicalTimeZone(value);
  if (!zone) {
    ctx.addIssue({ code: "custom", message: "not an IANA time zone" });
    return z.NEVER;
  }
  return zone;
});

/** The stored value if it is a valid IANA zone (in its canonical name), otherwise the fallback. */
export function toTenantTimeZone(raw: unknown): TenantTimeZone {
  const parsed = TimeZoneName.safeParse(raw);
  return parsed.success ? { timeZone: parsed.data, isFallback: false } : { timeZone: TENANT_TIME_ZONE_FALLBACK, isFallback: true };
}

/** Uncached read, for the cache below and for the integration tests. */
export async function readTenantTimeZone(tenantId: string): Promise<TenantTimeZone> {
  const rows = await prisma.$queryRaw<{ time_zone: string | null }[]>`
    SELECT public.tenant_time_zone(${tenantId}::uuid) AS time_zone`;
  return toTenantTimeZone(rows[0]?.time_zone ?? null);
}

/** One read per request, and one per tenant per minute across requests. */
export const getTenantTimeZone = cache(
  (tenantId: string): Promise<TenantTimeZone> =>
    unstable_cache(() => readTenantTimeZone(tenantId), ["tenant-time-zone", tenantId], {
      tags: [tenantTimeZoneTag(tenantId)],
      revalidate: TENANT_TIME_ZONE_REVALIDATE_SECONDS,
    })(),
);

/** The time zone of the signed-in user's tenant, from the verified token. */
export async function getSessionTimeZone(): Promise<string> {
  const claims = await requireAuth();
  if (!claims.tenantId) return TENANT_TIME_ZONE_FALLBACK;
  return (await getTenantTimeZone(claims.tenantId)).timeZone;
}
