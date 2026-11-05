import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { appRoleFromClaims, aalFromClaims, mfaStepFor, requiresAal2 } from "@/lib/auth/mfa-policy";
import { COMPANY_CODE_COOKIE, requestedTenant, tenantAccessAllowed, tenantNotFound } from "@/lib/tenant/host";
import { TENANT_ID_HEADER } from "@/lib/log/request-context";
import { supabaseServerTarget } from "./server-url";

const PUBLIC_PATHS = ["/login", "/auth", "/signup"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const target = supabaseServerTarget();

  const supabase = createServerClient(
    target.url,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: target.cookieName },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Validate session server-side and refresh the token when needed.
  // getUser() is required so the cookie carries the latest JWT from the
  // custom_access_token_hook (with app_role and tenant_id).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user) {
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims ?? null;

    // D27: logs downstream carry the token's tenant. NextResponse.next() copies
    // the request headers when it is created, so rebuild it (keeping any
    // refreshed session cookies) after setting the header.
    if (typeof claims?.tenant_id === "string" && claims.tenant_id !== "") {
      request.headers.set(TENANT_ID_HEADER, claims.tenant_id);
      const forwarded = NextResponse.next({ request });
      supabaseResponse.cookies.getAll().forEach((cookie) => forwarded.cookies.set(cookie));
      supabaseResponse = forwarded;
    }

    // D21: the tenant of the subdomain or company code must be the token's
    // tenant and active; every refusal gets the same 404. Anonymous visitors
    // are never told whether a tenant exists: they all get the login redirect.
    if (!isPublic) {
      const requested = requestedTenant(
        request.headers.get("host"),
        request.cookies.get(COMPANY_CODE_COOKIE)?.value,
      );
      const tokenTenant = typeof claims?.tenant_id === "string" ? claims.tenant_id : "";
      if (!(await tenantAccessAllowed(supabase, requested, tokenTenant))) {
        const refused = tenantNotFound();
        // Keep a refreshed session: dropping its cookies would reuse a rotated refresh token.
        supabaseResponse.cookies.getAll().forEach((cookie) => refused.cookies.set(cookie));
        return refused;
      }
    }

    if (claims && requiresAal2(pathname, appRoleFromClaims(claims)) && aalFromClaims(claims) !== "aal2") {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const url = request.nextUrl.clone();
      url.pathname = mfaStepFor(aal?.nextLevel);
      url.search = "";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
