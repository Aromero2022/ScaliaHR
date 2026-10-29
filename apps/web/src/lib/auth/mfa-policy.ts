// MFA policy shared by the middleware and server components. Pure functions:
// the inputs are the verified JWT claims, never user.app_metadata, because the
// custom access token hook writes tenant_id and app_role at the claim root.

export const MFA_REQUIRED_ROLES = ["owner", "hr_admin"] as const;
export const AAL2_PATHS = ["/admin-center"] as const;
export const MFA_PATHS = ["/mfa/enroll", "/mfa/verify"] as const;

type Claims = Record<string, unknown> | null | undefined;

function matchesPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function isMfaPath(pathname: string): boolean {
  return MFA_PATHS.some((p) => matchesPath(pathname, p));
}

/** app_role as written by custom_access_token_hook (claim root). */
export function appRoleFromClaims(claims: Claims): string | null {
  const role = claims?.app_role;
  return typeof role === "string" && role !== "" ? role : null;
}

export function aalFromClaims(claims: Claims): "aal1" | "aal2" {
  return claims?.aal === "aal2" ? "aal2" : "aal1";
}

/** Owner and hr_admin need AAL2 everywhere; anyone needs it on AAL2_PATHS. */
export function requiresAal2(pathname: string, appRole: string | null): boolean {
  if (isMfaPath(pathname)) return false;
  if (appRole && (MFA_REQUIRED_ROLES as readonly string[]).includes(appRole)) return true;
  return AAL2_PATHS.some((p) => matchesPath(pathname, p));
}

/**
 * Where to send a session that is below AAL2: users with a verified factor
 * (nextLevel aal2) verify it; users without one enroll first.
 */
export function mfaStepFor(nextLevel: string | null | undefined): "/mfa/verify" | "/mfa/enroll" {
  return nextLevel === "aal2" ? "/mfa/verify" : "/mfa/enroll";
}

/** Only same-origin absolute paths are accepted as post-MFA destinations. */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return isMfaPath(next) ? fallback : next;
}
