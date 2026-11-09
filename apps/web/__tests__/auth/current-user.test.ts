import { beforeEach, describe, expect, it, vi } from "vitest";

// D45: the signed-in person's employee row. No row is a valid case (null); a
// failed read is not, and must never look like "no session".

const headerValues = new Map<string, string>();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => headerValues) }));

const getClaims = vi.fn();
vi.mock("@/lib/supabase/claims", () => ({ getClaims: () => getClaims() }));

let answer: { data: unknown; error: unknown } = { data: null, error: null };
const maybeSingle = vi.fn(async () => answer);
const eq = vi.fn(() => ({ maybeSingle }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ select: () => ({ eq }) }) }),
}));

import { CurrentUserUnavailable, currentUserOrError, getCurrentUser } from "@/lib/auth/current-user";

const err = vi.spyOn(console, "error").mockImplementation(() => {});
const row = { id: "u-1", tenant_id: "t-1", position_id: null };

beforeEach(() => {
  vi.clearAllMocks();
  headerValues.clear();
  headerValues.set("x-request-id", "req-45").set("x-tenant-id", "t-1");
  getClaims.mockResolvedValue({ userId: "auth-1", tenantId: "t-1" });
  answer = { data: row, error: null };
});

describe("getCurrentUser (D35, D45)", () => {
  it("reads the row of the signed-in account with maybeSingle", async () => {
    await expect(getCurrentUser()).resolves.toEqual(row);
    expect(eq).toHaveBeenCalledWith("auth_uid", "auth-1");
    expect(maybeSingle).toHaveBeenCalled();
  });

  it("is null without a session, and null for an account without an employee row", async () => {
    getClaims.mockResolvedValueOnce(null);
    await expect(getCurrentUser()).resolves.toBeNull();
    answer = { data: null, error: null };
    await expect(getCurrentUser()).resolves.toBeNull();
    expect(err).not.toHaveBeenCalled();
  });

  it("throws CurrentUserUnavailable with the generic message and request id when the read fails, and logs the detail", async () => {
    answer = { data: null, error: { code: "42501", message: "permission denied for table users" } };

    const thrown = await getCurrentUser().catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(CurrentUserUnavailable);
    expect((thrown as CurrentUserUnavailable).userMessage).toBe("No se pudo cargar esta página. Código: req-45");
    expect((thrown as CurrentUserUnavailable).userMessage).not.toMatch(/permission|users/);
    const line = JSON.parse(String(err.mock.calls[0][0]));
    expect(line).toMatchObject({ level: "error", event: "auth.current_user", requestId: "req-45", tenantId: "t-1", error: { code: "42501" } });
  });

  it("currentUserOrError gives Server Actions and routes the message instead of throwing", async () => {
    await expect(currentUserOrError()).resolves.toEqual({ user: row, error: null });
    answer = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    await expect(currentUserOrError()).resolves.toEqual({ user: null, error: "No se pudo cargar esta página. Código: req-45" });
  });
});
