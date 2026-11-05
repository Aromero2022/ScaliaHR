import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { REQUEST_ID_HEADER, TENANT_ID_HEADER } from "@/lib/log/request-context";
import { NONCE_HEADER, contentSecurityPolicy, createNonce } from "@/lib/security/csp";

export async function middleware(request: NextRequest) {
  // D27: every request gets a fresh id; whatever the client sent is replaced.
  // The tenant id header is set from the verified token in updateSession only.
  const requestId = crypto.randomUUID();
  request.headers.set(REQUEST_ID_HEADER, requestId);
  request.headers.delete(TENANT_ID_HEADER);
  // D29: a fresh nonce per request. Next.js reads the CSP of the request to put
  // the nonce on its own scripts; the browser enforces the response's.
  const nonce = createNonce();
  const csp = contentSecurityPolicy(nonce);
  request.headers.set(NONCE_HEADER, nonce);
  request.headers.set("Content-Security-Policy", csp);
  const response = await updateSession(request);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

// api/health stays out: healthchecks run without a session and must not depend on Auth.
export const config = {
  matcher: [
    "/((?!api/health$|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
