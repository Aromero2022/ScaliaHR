import type { Instrumentation } from "next";

// D27: errors Next.js catches (server components, route handlers, Server
// Actions that throw) reach the error reporter with the request id and tenant
// id the middleware set. The user only sees error.tsx and the digest.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // D45: the protected layout already showed it and safeError() already logged
  // its detail (auth.current_user, same request id); the pages that rendered in
  // parallel and rethrew it are not a second failure. By name: this file is a
  // separate bundle, so instanceof would not match.
  if (error instanceof Error && error.name === "CurrentUserUnavailable") return;
  const { reportError } = await import("./lib/log/report");
  const header = (name: string) => {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  reportError(
    "request.error",
    error,
    { requestId: header("x-request-id"), tenantId: header("x-tenant-id") },
    { method: request.method, path: request.path.split("?")[0], routeType: context.routeType, routePath: context.routePath },
  );
};
