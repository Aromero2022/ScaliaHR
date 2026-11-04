import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = { set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => jar) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/claims", () => ({ getClaims: vi.fn() }));
vi.mock("@/lib/audit/log", () => ({ writeAuditLog: vi.fn() }));

import { rememberCompanyCode } from "@/app/login/actions";

beforeEach(() => vi.clearAllMocks());

describe("rememberCompanyCode (D21)", () => {
  it("stores a normalized company code in an httpOnly cookie", async () => {
    await expect(rememberCompanyCode("  Acme-Corp ")).resolves.toEqual({});
    expect(jar.set).toHaveBeenCalledWith(
      "scalia_company",
      "acme-corp",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });

  it("clears the cookie when the code is empty", async () => {
    await expect(rememberCompanyCode("")).resolves.toEqual({});
    expect(jar.delete).toHaveBeenCalledWith("scalia_company");
    expect(jar.set).not.toHaveBeenCalled();
  });

  it.each(["a", "acme corp", "acme.corp", "<script>", 42, null])("rejects %s with a generic error", async (input) => {
    await expect(rememberCompanyCode(input)).resolves.toEqual({ error: "Código de empresa inválido" });
    expect(jar.set).not.toHaveBeenCalled();
    expect(jar.delete).not.toHaveBeenCalled();
  });
});
