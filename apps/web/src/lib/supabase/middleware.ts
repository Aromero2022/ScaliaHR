import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { appRoleFromClaims, aalFromClaims, mfaStepFor, requiresAal2 } from "@/lib/auth/mfa-policy";

const PUBLIC_PATHS = ["/login", "/auth", "/signup"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
