"use server";

import { z } from "zod";
import { getClaims } from "@/lib/supabase/claims";
import { writeAuditLog } from "@/lib/audit/log";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit, limitWrite, rateLimitMessage } from "@/lib/rate-limit";
import { mfaErrorMessage } from "@/lib/auth/messages";

const MfaCode = z.object({
  factorId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});

/**
 * D28: the TOTP check runs on the server behind the mfa_verify bucket (one
 * per user in their tenant), fail-closed, and audits success and failure here
 * instead of trusting the page to report them.
 */
export async function verifyMfa(input: unknown): Promise<{ error?: string }> {
  const parsed = MfaCode.safeParse(input);
  if (!parsed.success) return { error: mfaErrorMessage({ status: 400 }) };

  const claims = await getClaims();
  if (!claims) return { error: mfaErrorMessage(null) };

  const limited = await consumeRateLimit("mfa_verify", [claims.tenantId ?? "", claims.userId]);
  if (!limited.allowed) return { error: rateLimitMessage(limited) };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify(parsed.data);
  if (error) {
    await logMfaVerifyFailed();
    return { error: mfaErrorMessage(error) };
  }

  await logMfaVerify();
  return {};
}

export async function logMfaEnroll(): Promise<void> {
  if (await limitWrite()) return;
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
    action: "MFA_ENROLL",
    entity: "mfa_factor",
  });
}

async function logMfaVerify(): Promise<void> {
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
    action: "MFA_VERIFY",
    entity: "mfa_factor",
  });
}

export async function logMfaEnrollFailed(): Promise<void> {
  if (await limitWrite()) return;
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
    action: "MFA_ENROLL_FAILED",
    entity: "mfa_factor",
  });
}

async function logMfaVerifyFailed(): Promise<void> {
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
    action: "MFA_VERIFY_FAILED",
    entity: "mfa_factor",
  });
}
