import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { LogContext } from "@/lib/log/logger";
import { reportError } from "@/lib/log/report";

// D21 — which tenant a request targets: `<slug>.<app host>` (acme-corp.localhost
// locally) or, on the app host itself, the company code chosen at login.

/** Same format createTenant accepts for slugs. */
export const TenantSlug = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const COMPANY_CODE_COOKIE = "scalia_company";

/** Host of APP_BASE_URL, e.g. "localhost" for http://localhost:3000. */
export function appHost(baseUrl: string | undefined = process.env.APP_BASE_URL): string {
  return new URL(baseUrl || "http://localhost:3000").hostname;
}

function hostname(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

/** True when the host is a tenant subdomain of the app host. */
export function isTenantHost(hostHeader: string | null, base: string = appHost()): boolean {
  return hostname(hostHeader)?.endsWith(`.${base}`) ?? false;
}

/**
 * The tenant slug the request asks for, or null when it asks for none. A
 * subdomain always wins over the company code; any label is returned as is
 * (a.b, UPPER…) and simply matches no tenant.
 */
export function requestedTenant(
  hostHeader: string | null,
  companyCode: string | undefined,
  base: string = appHost(),
): string | null {
  const host = hostname(hostHeader);
  if (host?.endsWith(`.${base}`)) return host.slice(0, -(base.length + 1));
  if (host === base && companyCode) return companyCode;
  return null;
}

/**
 * Whether the signed-in user may work on the requested tenant: it must be the
 * tenant in their token and not be suspended. RLS on tenants shows each user
 * only their own tenant, so another tenant, a suspended one, an unknown slug or
 * a failed lookup all look the same and are all refused.
 */
export async function tenantAccessAllowed(
  supabase: SupabaseClient,
  requested: string | null,
  tokenTenantId: string,
  ctx: LogContext = {},
): Promise<boolean> {
  if (requested === null && tokenTenantId === "") return true;
  if (requested !== null && !TenantSlug.safeParse(requested).success) return false;

  const { data, error } = await (requested !== null
    ? supabase.from("tenants").select("id, suspended_at").eq("slug", requested)
    : supabase.from("tenants").select("id, suspended_at").eq("id", tokenTenantId)
  ).maybeSingle<{ id: string; suspended_at: string | null }>();
  // D45: still refused (fail closed, the same 404), but the failure is in the
  // logs with the request id, not hidden behind "unknown tenant".
  if (error) {
    reportError("tenant.access_lookup", error, ctx);
    return false;
  }
  if (!data) return false;
  return data.id === tokenTenantId && data.suspended_at === null;
}

const NOT_FOUND_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>No encontrado</title></head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="text-align:center;padding:16px"><h1>No encontrado</h1><p>La página que buscas no existe.</p><p><a href="/login">Volver a iniciar sesión</a></p></main>
</body></html>`;

/** The one response for every refused tenant: it never says which case it was. */
export function tenantNotFound(): NextResponse {
  return new NextResponse(NOT_FOUND_HTML, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
