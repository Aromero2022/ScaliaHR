import { headers } from "next/headers";
import type { LogContext } from "./logger";

// The middleware sets both headers on every request and never trusts the
// client's (D27): x-request-id is always fresh, x-tenant-id comes from the
// verified token. They are for logs only, never for authorization.
export const REQUEST_ID_HEADER = "x-request-id";
export const TENANT_ID_HEADER = "x-tenant-id";

/** The ids of the current request, or none outside a request (scripts, jobs). */
export async function requestContext(): Promise<LogContext> {
  try {
    const h = await headers();
    return {
      requestId: h.get(REQUEST_ID_HEADER) ?? undefined,
      tenantId: h.get(TENANT_ID_HEADER) ?? undefined,
    };
  } catch {
    return {};
  }
}
