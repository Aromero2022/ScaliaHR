import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = { getUser: vi.fn(), getClaims: vi.fn(), mfa: { getAuthenticatorAssuranceLevel: vi.fn() } };
const from = vi.fn(() => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "t1", suspended_at: null }, error: null }) }) }),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(() => ({ auth, from })) }));

import { middleware } from "@/middleware";

function session(claims: Record<string, unknown> | null) {
  auth.getUser.mockResolvedValue({ data: { user: claims ? { id: claims.sub } : null }, error: null });
  auth.getClaims.mockResolvedValue({ data: claims && { claims }, error: null });
}

async function visit(path: string, headers: Record<string, string> = {}) {
  return middleware(new NextRequest(`http://localhost:3000${path}`, { headers: { host: "localhost:3000", ...headers } }));
}
/** What the page or Server Action will read from the request headers. */
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
});

describe("request and tenant ids (D27)", () => {
  it("gives every request a fresh id, on the response and forwarded to the page", async () => {
    session({ sub: "u1", tenant_id: "t1", app_role: "employee", aal: "aal1" });
    const res = await visit("/dashboard", { "x-request-id": "spoofed" });
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(UUID);
    expect(forwarded(res, "x-request-id")).toBe(id);
    const again = await visit("/dashboard");
    expect(again.headers.get("x-request-id")).not.toBe(id);
  });

  it("forwards the token's tenant and replaces whatever the client sent", async () => {
    session({ sub: "u1", tenant_id: "t1", app_role: "employee", aal: "aal1" });
    const res = await visit("/dashboard", { "x-tenant-id": "other-tenant" });
    expect(forwarded(res, "x-tenant-id")).toBe("t1");
  });

  it("forwards no tenant for anonymous visitors, even when the client sends one", async () => {
    session(null);
    const res = await visit("/login", { "x-tenant-id": "other-tenant" });
    expect(res.headers.get("x-request-id")).toMatch(UUID);
    expect(forwarded(res, "x-tenant-id")).toBeNull();
  });

  it("keeps the request id on redirects too", async () => {
    session(null);
    const res = await visit("/dashboard");
    expect(res.status).toBe(307);
    expect(res.headers.get("x-request-id")).toMatch(UUID);
  });
});
