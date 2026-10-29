import { describe, expect, it } from "vitest";
import {
  aalFromClaims,
  appRoleFromClaims,
  mfaStepFor,
  requiresAal2,
  safeNextPath,
} from "@/lib/auth/mfa-policy";

describe("appRoleFromClaims", () => {
  it("reads app_role from the claim root", () => {
    expect(appRoleFromClaims({ app_role: "owner" })).toBe("owner");
  });

  it("ignores app_role inside app_metadata", () => {
    expect(appRoleFromClaims({ app_metadata: { app_role: "owner" } })).toBeNull();
  });

  it("returns null for missing, empty or non-string values", () => {
    expect(appRoleFromClaims(null)).toBeNull();
    expect(appRoleFromClaims({ app_role: "" })).toBeNull();
    expect(appRoleFromClaims({ app_role: ["owner"] })).toBeNull();
  });
});

describe("aalFromClaims", () => {
  it("is aal2 only when the token says so", () => {
    expect(aalFromClaims({ aal: "aal2" })).toBe("aal2");
    expect(aalFromClaims({ aal: "aal1" })).toBe("aal1");
    expect(aalFromClaims({})).toBe("aal1");
    expect(aalFromClaims(null)).toBe("aal1");
  });
});

describe("requiresAal2", () => {
  it("applies to owner and hr_admin on every protected path", () => {
    for (const role of ["owner", "hr_admin"]) {
      expect(requiresAal2("/dashboard", role)).toBe(true);
      expect(requiresAal2("/employees/123", role)).toBe(true);
    }
  });

  it("does not apply to other roles outside AAL2 paths", () => {
    for (const role of ["employee", "manager", null]) {
      expect(requiresAal2("/dashboard", role)).toBe(false);
    }
  });

  it("applies to everyone on /admin-center and its subpaths", () => {
    for (const role of ["employee", "manager", null]) {
      expect(requiresAal2("/admin-center", role)).toBe(true);
      expect(requiresAal2("/admin-center/manage-roles", role)).toBe(true);
    }
    expect(requiresAal2("/admin-centerx", "employee")).toBe(false);
  });

  it("never applies on the MFA pages themselves", () => {
    expect(requiresAal2("/mfa/enroll", "owner")).toBe(false);
    expect(requiresAal2("/mfa/verify", "hr_admin")).toBe(false);
  });
});

describe("mfaStepFor", () => {
  it("verifies when a factor is enrolled and enrolls otherwise", () => {
    expect(mfaStepFor("aal2")).toBe("/mfa/verify");
    expect(mfaStepFor("aal1")).toBe("/mfa/enroll");
    expect(mfaStepFor(undefined)).toBe("/mfa/enroll");
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeNextPath("/admin-center/manage-roles")).toBe("/admin-center/manage-roles");
  });

  it("rejects external, protocol-relative and MFA destinations", () => {
    for (const next of ["https://evil.test", "//evil.test", "/\\evil.test", "evil", "/mfa/verify", null]) {
      expect(safeNextPath(next)).toBe("/dashboard");
    }
  });
});
