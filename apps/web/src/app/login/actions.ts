"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { getClaims } from "@/lib/supabase/claims";
import { writeAuditLog } from "@/lib/audit/log";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_CODE_COOKIE, TenantSlug, requestedTenant } from "@/lib/tenant/host";
import { clientIp, consumeRateLimit, limitWrite, rateLimitMessage } from "@/lib/rate-limit";
import { signInErrorMessage } from "@/lib/auth/messages";
import { log } from "@/lib/log/logger";
import { requestContext } from "@/lib/log/request-context";

const CompanyCode = z.string().trim().toLowerCase().pipe(z.union([z.literal(""), TenantSlug]));

const Credentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).max(256),
});

/**
 * D21: on the app host the company code picks the tenant the session must
 * belong to (subdomains carry it in the host instead). Only the format is
 * checked here, so the answer never tells whether that company exists.
 */
export async function rememberCompanyCode(input: unknown): Promise<{ error?: string }> {
  const limited = await limitWrite();
  if (limited) return { error: limited };

  const parsed = CompanyCode.safeParse(input);
  if (!parsed.success) return { error: "Código de empresa inválido" };
  const jar = await cookies();
  if (parsed.data === "") {
    jar.delete(COMPANY_CODE_COOKIE);
  } else {
    jar.set(COMPANY_CODE_COOKIE, parsed.data, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return {};
}

/**
 * D28: the password sign-in runs on the server so the limiter cannot be
 * skipped by the login form. One token per attempt from the client IP and one
 * from the account (requested tenant + email); either one empty, or the
 * limiter unreachable, refuses the attempt before Supabase Auth sees it.
 */
export async function signIn(input: unknown): Promise<{ error?: string }> {
  const parsed = Credentials.safeParse(input);
  if (!parsed.success) return { error: signInErrorMessage({ status: 400 }) };
  const { email, password } = parsed.data;

  const tenant = requestedTenant((await headers()).get("host"), (await cookies()).get(COMPANY_CODE_COOKIE)?.value) ?? "";
  for (const [action, parts] of [
    ["login_ip", [await clientIp()]],
    ["login", [tenant, email]],
  ] as const) {
    const result = await consumeRateLimit(action, parts);
    if (!result.allowed) return { error: rateLimitMessage(result) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    log("info", "auth.login_failed", { status: error.status }, await requestContext());
    return { error: signInErrorMessage(error) };
  }

  await auditLogin();
  return {};
}

async function auditLogin(): Promise<void> {
  const claims = await getClaims();
  if (!claims?.tenantId) return;

  const sb = await createClient();
  const { data: bizUser } = await sb
    .from("users")
    .select("id")
    .eq("auth_uid", claims.userId)
    .single();

  if (!bizUser) return;

  await writeAuditLog({
    tenantId: claims.tenantId,
    actorId: bizUser.id,
    action: "AUTH_LOGIN",
    entity: "session",
  });
}
