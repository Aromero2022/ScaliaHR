import { createClient } from "./server";
import { aalFromClaims, appRoleFromClaims, mfaStepFor } from "@/lib/auth/mfa-policy";

export type SessionClaims = {
  userId: string;
  email: string;
  tenantId: string | null;
  appRole: string | null;
  aal: "aal1" | "aal2";
};

// Reads the verified JWT: tenant_id and app_role are written at the claim
// root by custom_access_token_hook, aal by Supabase Auth.
export async function getClaims(): Promise<SessionClaims | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) return null;

  return {
    userId: claims.sub,
    email: claims.email ?? "",
    tenantId: typeof claims.tenant_id === "string" ? claims.tenant_id : null,
    appRole: appRoleFromClaims(claims),
    aal: aalFromClaims(claims),
  };
}

export async function requireAuth(): Promise<SessionClaims> {
  const claims = await getClaims();
  if (!claims) {
    const { redirect } = await import("next/navigation");
    return redirect("/login") as never;
  }
  return claims;
}

// Page-level guard for AAL2 routes, independent of the middleware.
export async function requireAal2(next: string): Promise<SessionClaims> {
  const claims = await requireAuth();

  if (claims.aal !== "aal2") {
    const supabase = await createClient();
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const { redirect } = await import("next/navigation");
    return redirect(`${mfaStepFor(data?.nextLevel)}?next=${encodeURIComponent(next)}`) as never;
  }

  return claims;
}
