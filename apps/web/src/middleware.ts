import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { REQUEST_ID_HEADER, TENANT_ID_HEADER } from "@/lib/log/request-context";

export async function middleware(request: NextRequest) {
  // D27: every request gets a fresh id; whatever the client sent is replaced.
  // The tenant id header is set from the verified token in updateSession only.
  const requestId = crypto.randomUUID();
  request.headers.set(REQUEST_ID_HEADER, requestId);
  request.headers.delete(TENANT_ID_HEADER);
  const response = await updateSession(request);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

// api/health stays out: healthchecks run without a session and must not depend on Auth.
export const config = {
  matcher: [
    "/((?!api/health$|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
