import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 9c PR 6d: "Actualizar información personal" is sent once, at the end of its
 * steps, and the Server Action validates the whole object with zod. A failed
 * validation returns the errors by field (messages from the schema only, D27)
 * and never reaches the actor lookup or the RPC.
 */

const USER_ID = "e0000000-0000-0000-0000-000000000001";
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockCan = vi.fn();

vi.mock("@/lib/rate-limit", () => ({ limitWrite: vi.fn(async () => null), limitRead: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser }, from: mockFrom, rpc: mockRpc })),
}));
vi.mock("@/lib/authz/can", () => ({ can: (...args: unknown[]) => mockCan(...args) }));
vi.mock("@/lib/audit/log", () => ({ writeAuditLog: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createPersonalInfoChange } from "@/app/(protected)/employees/[id]/actions";
import { messages } from "@/lib/i18n/es-MX";

const t = messages.personalInfoForm;
const valid = {
  userId: USER_ID,
  startDate: "2026-11-27",
  firstName: "Ana",
  lastName: "López",
  personalEmail: "ana@example.com",
  country: "MX",
  eventReason: "Cambio de domicilio",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "actor-1", tenant_id: "t1" }, error: null }),
      }),
    }),
  });
  mockCan.mockResolvedValue({ allowed: true });
  mockRpc.mockResolvedValue({ data: "rec-1", error: null });
});

describe("createPersonalInfoChange validates the whole object (9c PR 6d)", () => {
  it("returns the errors of every step by field, in Spanish, and calls nothing else", async () => {
    const result = await createPersonalInfoChange({ ...valid, firstName: "", personalEmail: "a@b", eventReason: "" });
    expect(result).toEqual({
      success: false,
      error: t.fixFields,
      fieldErrors: { firstName: t.required, personalEmail: t.invalidEmail, eventReason: "Motivo requerido" },
    });
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("keeps the earlier single message for an error that no field shows (the employee's id)", async () => {
    const result = await createPersonalInfoChange({ ...valid, userId: "not-an-id" });
    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty("fieldErrors");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("leaves out of fieldErrors an error that no field shows when fields fail too", async () => {
    const result = await createPersonalInfoChange({ ...valid, userId: "not-an-id", firstName: "" });
    expect(result).toEqual({ success: false, error: t.fixFields, fieldErrors: { firstName: t.required } });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("saves a valid object with one RPC", async () => {
    const result = await createPersonalInfoChange(valid);
    expect(result).toEqual({ success: true, data: { id: "rec-1" } });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("insert_effective_record", expect.objectContaining({ p_table: "ec_personal_information", p_user_id: USER_ID }));
  });
});
