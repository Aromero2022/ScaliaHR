import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/tenant-client";
import { getClaims, type SessionClaims } from "@/lib/supabase/claims";
import { log } from "@/lib/log/logger";
import { reportError } from "@/lib/log/report";
import { requestContext } from "@/lib/log/request-context";
import { tooManyRequestsText, waitText } from "@/lib/rate-limit-message";

/**
 * D28 — every attempt spends a token of public.rate_limit_consume(), called
 * through prisma_app so it works before a session exists and no Data API
 * client can touch the buckets. Login, MFA and tenant creation fail closed:
 * if the limiter cannot answer, the attempt is refused. The rest fail open,
 * so a database hiccup does not stop ordinary work.
 */

type Policy = { maxTokens: number; windowSeconds: number; failClosed: boolean };

export const RATE_LIMITS = {
  // Before a session: per client IP, and per account (requested tenant + email).
  login_ip: { maxTokens: 20, windowSeconds: 60, failClosed: true },
  login: { maxTokens: 5, windowSeconds: 60, failClosed: true },
  mfa_verify: { maxTokens: 5, windowSeconds: 60, failClosed: true },
  tenant_create: { maxTokens: 3, windowSeconds: 3600, failClosed: true },
  // Per signed-in user; each tenant can change these from Admin Center.
  write: { maxTokens: 30, windowSeconds: 60, failClosed: false },
  api: { maxTokens: 30, windowSeconds: 60, failClosed: false },
} as const satisfies Record<string, Policy>;

export type RateLimitAction = keyof typeof RATE_LIMITS;
export type Refused = { allowed: false; retryAfter: number; reason: "limited" | "unavailable" };
export type RateLimitResult = { allowed: true } | Refused;

/** Retry-After when a fail-closed check could not reach the limiter. */
const UNAVAILABLE_RETRY_SECONDS = 30;

/** Bucket key: a hash, so no email or IP is stored in rate_limits. */
export function rateLimitKey(action: RateLimitAction, parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([action, ...parts])).digest("base64url");
}

/** Spends one token. With tenantId, that tenant's own limit (if any) applies. */
export async function consumeRateLimit(
  action: RateLimitAction,
  parts: readonly string[],
  tenantId: string | null = null,
): Promise<RateLimitResult> {
  const policy: Policy = RATE_LIMITS[action];
  const ctx = await requestContext();
  try {
    const rows = await prisma.$queryRaw<{ retry_after: number }[]>`
      SELECT public.rate_limit_consume(
        ${rateLimitKey(action, parts)}, ${action}, ${policy.maxTokens}::int,
        ${policy.windowSeconds}::int, ${tenantId}::uuid
      ) AS retry_after`;
    const retryAfter = Number(rows[0]?.retry_after ?? 0);
    if (retryAfter <= 0) return { allowed: true };
    log("warn", "rate_limit.blocked", { action, retryAfter }, ctx);
    return { allowed: false, retryAfter, reason: "limited" };
  } catch (error) {
    reportError("rate_limit.check_failed", error, ctx, { action, failClosed: policy.failClosed });
    if (!policy.failClosed) return { allowed: true };
    return { allowed: false, retryAfter: UNAVAILABLE_RETRY_SECONDS, reason: "unavailable" };
  }
}

/**
 * The client address: the last X-Forwarded-For hop, which the proxy in front
 * of the app writes (Phase 23). With no proxy a client can send its own header,
 * so the per-IP bucket is only a first barrier; account and user buckets do not
 * depend on the IP.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const hops = (h.get("x-forwarded-for") ?? "").split(",").map((hop) => hop.trim()).filter(Boolean);
  return hops.at(-1) ?? h.get("x-real-ip") ?? "unknown";
}

/** What a form shows when an attempt is refused. */
export function rateLimitMessage(result: Refused): string {
  if (result.reason === "unavailable") {
    return `No se pudo procesar la solicitud. Intenta de nuevo en ${waitText(result.retryAfter)}.`;
  }
  return tooManyRequestsText(result.retryAfter);
}

/** The HTTP answer for a refused request: 429 with Retry-After. */
export function tooManyRequests(result: Refused): Response {
  return Response.json(
    { error: "too_many_requests" },
    { status: 429, headers: { "Retry-After": String(result.retryAfter), "Cache-Control": "no-store" } },
  );
}

/** The caller's bucket: the signed-in user in their tenant, or the client IP. */
async function consumeForCaller(action: "write" | "api"): Promise<RateLimitResult> {
  const claims: SessionClaims | null = await getClaims();
  if (!claims) return consumeRateLimit(action, ["ip", await clientIp()]);
  return consumeRateLimit(action, [claims.tenantId ?? "", claims.userId], claims.tenantId);
}

/** First line of every write Server Action: the message to return, or null to go on. */
export async function limitWrite(): Promise<string | null> {
  const result = await consumeForCaller("write");
  return result.allowed ? null : rateLimitMessage(result);
}

/**
 * First line of a Server Action that only reads (D45: the lists of "Tomar
 * Acción"): it spends a token of the api bucket, like an HTTP route, so reads
 * do not use up the person's writes. The message to return, or null to go on.
 */
export async function limitRead(): Promise<string | null> {
  const result = await consumeForCaller("api");
  return result.allowed ? null : rateLimitMessage(result);
}

/** First line of every HTTP route: the 429 to return, or null to go on. */
export async function limitApi(): Promise<Response | null> {
  const result = await consumeForCaller("api");
  return result.allowed ? null : tooManyRequests(result);
}
