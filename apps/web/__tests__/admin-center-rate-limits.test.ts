import { beforeEach, describe, expect, it, vi } from "vitest";

// D28: the limiter has its own tests; here every attempt is allowed.
vi.mock("@/lib/rate-limit", () => ({ limitWrite: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit/log", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/authz/can", () => ({ can: vi.fn() }));
vi.mock("@/lib/supabase/claims", () => ({ getClaims: vi.fn() }));

const upsert = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) =>
      table === "users"
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "biz-1", tenant_id: "t-1", position_id: null }, error: null }) }) }) }
        : { upsert: (...args: unknown[]) => upsert(...args) },
  })),
}));

import { updateTenantRateLimit } from "@/app/(protected)/admin-center/actions";
import { getClaims } from "@/lib/supabase/claims";
import { can } from "@/lib/authz/can";
import { writeAuditLog } from "@/lib/audit/log";

const admin = { userId: "auth-1", email: "a@b.c", tenantId: "t-1", appRole: "owner", aal: "aal2" as const };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClaims).mockResolvedValue(admin);
  vi.mocked(can).mockResolvedValue({ allowed: true } as Awaited<ReturnType<typeof can>>);
  upsert.mockResolvedValue({ error: null });
});

describe("updateTenantRateLimit (D28)", () => {
  it("saves the tenant's own limit and audits the change", async () => {
    await expect(updateTenantRateLimit({ action: "write", maxTokens: "45", windowSeconds: "90" })).resolves.toEqual({});
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: "t-1", action: "write", max_tokens: 45, window_seconds: 90 }),
      { onConflict: "tenant_id,action" },
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "RATE_LIMIT_UPDATED", diff: { action: "write", max_tokens: 45, window_seconds: 90 } }),
    );
  });

  it.each([
    [{ action: "login", maxTokens: 5, windowSeconds: 60 }, "Límite desconocido"],
    [{ action: "write", maxTokens: 0, windowSeconds: 60 }, "Mínimo 1 solicitud"],
    [{ action: "write", maxTokens: 601, windowSeconds: 60 }, "Máximo 600 solicitudes"],
    [{ action: "api", maxTokens: 10, windowSeconds: 5 }, "La ventana mínima es de 10 segundos"],
    [{ action: "api", maxTokens: 10, windowSeconds: 3601 }, "La ventana máxima es de 3600 segundos"],
    [{ action: "api", maxTokens: 1.5, windowSeconds: 60 }, "Usa un número entero"],
  ])("rejects %o", async (input, message) => {
    await expect(updateTenantRateLimit(input)).resolves.toEqual({ error: message });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("requires MFA and admin.manage_config", async () => {
    vi.mocked(getClaims).mockResolvedValueOnce({ ...admin, aal: "aal1" });
    expect((await updateTenantRateLimit({ action: "api", maxTokens: 10, windowSeconds: 60 })).error).toMatch(/MFA/);
    vi.mocked(can).mockResolvedValueOnce({ allowed: false } as Awaited<ReturnType<typeof can>>);
    expect(await updateTenantRateLimit({ action: "api", maxTokens: 10, windowSeconds: 60 })).toEqual({
      error: "Sin permiso para cambiar la configuración",
    });
    expect(can).toHaveBeenLastCalledWith("biz-1", "admin.manage_config", "edit");
    expect(upsert).not.toHaveBeenCalled();
  });
});
