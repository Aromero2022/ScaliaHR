import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  getClaims: vi.fn(),
  mfa: { getAuthenticatorAssuranceLevel: vi.fn() },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth })),
}));

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`);
});
vi.mock("next/navigation", () => ({ redirect }));

import { getClaims, requireAal2 } from "@/lib/supabase/claims";

function token(claims: Record<string, unknown> | null, nextLevel = "aal1") {
  auth.getClaims.mockResolvedValue({ data: claims && { claims }, error: null });
  auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { nextLevel }, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getClaims", () => {
  it("maps root claims written by the access token hook", async () => {
    token({ sub: "u1", email: "a@b.test", tenant_id: "t1", app_role: "hr_admin", aal: "aal2" });
    expect(await getClaims()).toEqual({
      userId: "u1",
      email: "a@b.test",
      tenantId: "t1",
      appRole: "hr_admin",
      aal: "aal2",
    });
  });

  it("does not read tenant or role from app_metadata", async () => {
    token({ sub: "u1", aal: "aal1", app_metadata: { tenant_id: "t1", app_role: "owner" } });
    expect(await getClaims()).toMatchObject({ tenantId: null, appRole: null, aal: "aal1" });
  });

  it("returns null without a verified token", async () => {
    token(null);
    expect(await getClaims()).toBeNull();
  });
});

describe("requireAal2", () => {
  it("returns the claims at aal2", async () => {
    token({ sub: "u1", app_role: "owner", aal: "aal2" });
    await expect(requireAal2("/admin-center")).resolves.toMatchObject({ userId: "u1" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects an aal1 session with a factor to verify", async () => {
    token({ sub: "u1", app_role: "employee", aal: "aal1" }, "aal2");
    await expect(requireAal2("/admin-center")).rejects.toThrow("REDIRECT /mfa/verify?next=%2Fadmin-center");
  });

  it("redirects an aal1 session without a factor to enroll", async () => {
    token({ sub: "u1", app_role: "employee", aal: "aal1" }, "aal1");
    await expect(requireAal2("/admin-center/manage-roles")).rejects.toThrow(
      "REDIRECT /mfa/enroll?next=%2Fadmin-center%2Fmanage-roles",
    );
  });

  it("redirects to /login without a session", async () => {
    token(null);
    await expect(requireAal2("/admin-center")).rejects.toThrow("REDIRECT /login");
  });
});
