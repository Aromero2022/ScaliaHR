import { describe, expect, it, vi } from "vitest";
import { onRequestError } from "@/instrumentation";
import { CurrentUserUnavailable } from "@/lib/auth/current-user";

describe("onRequestError (D27)", () => {
  it("reports unhandled errors as JSON with the middleware's ids and no query string", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("relation does not exist, rfc GODE561231GR8"), { digest: "4242" });
    await onRequestError(
      error,
      { path: "/employees?q=GODE561231GR8", method: "GET", headers: { "x-request-id": "req-7", "x-tenant-id": "tenant-7" } },
      { routerKind: "App Router", routePath: "/employees", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined },
    );
    const line = JSON.parse(String(err.mock.calls.at(-1)?.[0]));
    expect(line).toMatchObject({
      level: "error",
      event: "request.error",
      requestId: "req-7",
      tenantId: "tenant-7",
      method: "GET",
      path: "/employees",
      routeType: "render",
      error: { digest: "4242", message: "relation does not exist, rfc [RFC]" },
    });
    expect(JSON.stringify(line)).not.toContain("GODE561231GR8");
    err.mockRestore();
  });

  it("D45: does not report CurrentUserUnavailable again; safeError already logged it with the same request id", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await onRequestError(
      new CurrentUserUnavailable("No se pudo cargar esta página. Código: req-8"),
      { path: "/dashboard", method: "GET", headers: { "x-request-id": "req-8" } },
      { routerKind: "App Router", routePath: "/dashboard", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined },
    );
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
