"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { getClaims } from "@/lib/supabase/claims";
import { writeAuditLog } from "@/lib/audit/log";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_CODE_COOKIE, TenantSlug } from "@/lib/tenant/host";

const CompanyCode = z.string().trim().toLowerCase().pipe(z.union([z.literal(""), TenantSlug]));

/**
 * D21: on the app host the company code picks the tenant the session must
 * belong to (subdomains carry it in the host instead). Only the format is
 * checked here, so the answer never tells whether that company exists.
 */
export async function rememberCompanyCode(input: unknown): Promise<{ error?: string }> {
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

export async function logLoginEvent(): Promise<void> {
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
