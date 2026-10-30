import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = {
  getUser: vi.fn(),
  getClaims: vi.fn(),
  mfa: { getAuthenticatorAssuranceLevel: vi.fn() },
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth })),
}));

import { updateSession } from "@/lib/supabase/middleware";

function session(claims: Record<string, unknown> | null, nextLevel: "aal1" | "aal2" = "aal1") {
  auth.getUser.mockResolvedValue({
    data: { user: claims ? { id: claims.sub } : null },
    error: claims ? null : { message: "not authenticated" },
  });
  auth.getClaims.mockResolvedValue({ data: claims && { claims }, error: null });
  auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
    data: { currentLevel: claims?.aal ?? null, nextLevel },
    error: null,
  });
}

async function visit(path: string) {
  const res = await updateSession(new NextRequest(`http://localhost:3000${path}`));
  const location = res.headers.get("location");
  return location ? new URL(location) : null;
}

const base = { sub: "u1", tenant_id: "t1", app_role: "employee", aal: "aal1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("middleware MFA policy", () => {
  it("redirects to /login without a session", async () => {
    session(null);
    expect((await visit("/dashboard"))?.pathname).toBe("/login");
  });

  it("lets public paths through without a session", async () => {
    session(null);
    expect(await visit("/login")).toBeNull();
  });

  it("sends an owner at aal1 without factor to enroll, keeping the destination", async () => {
    session({ ...base, app_role: "owner" }, "aal1");
    const to = await visit("/dashboard");
    expect(to?.pathname).toBe("/mfa/enroll");
    expect(to?.searchParams.get("next")).toBe("/dashboard");
  });

  it("sends an hr_admin at aal1 with a verified factor to verify", async () => {
    session({ ...base, app_role: "hr_admin" }, "aal2");
    expect((await visit("/employees"))?.pathname).toBe("/mfa/verify");
  });

  it("lets an owner at aal2 through", async () => {
    session({ ...base, app_role: "owner", aal: "aal2" }, "aal2");
    expect(await visit("/dashboard")).toBeNull();
  });

  it("reads app_role from the claim, not from app_metadata", async () => {
    session({ ...base, app_role: "employee", app_metadata: { app_role: "owner" } });
    expect(await visit("/dashboard")).toBeNull();

    session({ ...base, app_role: "owner", app_metadata: { app_role: "employee" } });
    expect((await visit("/dashboard"))?.pathname).toBe("/mfa/enroll");
  });

  it("requires aal2 on /admin-center for any role", async () => {
    session({ ...base, app_role: "employee" }, "aal2");
    const to = await visit("/admin-center/manage-roles");
    expect(to?.pathname).toBe("/mfa/verify");
    expect(to?.searchParams.get("next")).toBe("/admin-center/manage-roles");
  });

  it("does not loop on the MFA pages", async () => {
    session({ ...base, app_role: "owner" });
    expect(await visit("/mfa/enroll")).toBeNull();
    expect(await visit("/mfa/verify")).toBeNull();
  });

  it("calls getUser() before getClaims() to validate and refresh the session", async () => {
    session({ ...base, app_role: "owner" });
    await visit("/dashboard");
    const getUserOrder = auth.getUser.mock.invocationCallOrder[0];
    const getClaimsOrder = auth.getClaims.mock.invocationCallOrder[0];
    expect(getUserOrder).toBeLessThan(getClaimsOrder);
  });

  it("redirects to login when getUser returns null (even if getClaims would succeed)", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    auth.getClaims.mockResolvedValue({
      data: { claims: { ...base, app_role: "owner" } },
      error: null,
    });
    expect((await visit("/dashboard"))?.pathname).toBe("/login");
  });
});
