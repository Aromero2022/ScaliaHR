import { beforeEach, describe, expect, it, vi } from "vitest";

const VALID_UUID = "a0000000-0000-4000-8000-000000000099";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

const mockGetClaims = vi.fn();
vi.mock("@/lib/supabase/claims", () => ({
  getClaims: (...args: unknown[]) => mockGetClaims(...args),
}));

const mockCan = vi.fn();
vi.mock("@/lib/authz/can", () => ({
  can: (...args: unknown[]) => mockCan(...args),
}));

vi.mock("@/lib/audit/log", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  createArcoRequest,
  processArcoRequest,
  exportUserData,
} from "@/app/(protected)/admin/arco/actions";

function mockProfile(userId: string, tenantId: string) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: userId, tenant_id: tenantId },
          error: null,
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: VALID_UUID },
          error: null,
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }),
  });
}

function authenticatedAsEmployee() {
  mockGetClaims.mockResolvedValue({
    userId: "auth-emp-1",
    tenantId: "t1",
    email: "emp@test.com",
    appRole: "member",
    aal: "aal1",
  });
  mockProfile("user-emp-1", "t1");
  mockCan.mockResolvedValue({ allowed: false, reason: "no_permission" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ARCO Server Actions authorization", () => {
  describe("createArcoRequest", () => {
    it("rejects an employee without arco.manage permission", async () => {
      authenticatedAsEmployee();
      const result = await createArcoRequest({
        subjectId: VALID_UUID,
        requestType: "acceso",
        description: "test request",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Sin permiso");
      }
      expect(mockCan).toHaveBeenCalledWith("user-emp-1", "arco.manage", "view");
    });
  });

  describe("processArcoRequest", () => {
    it("rejects an employee without arco.manage permission", async () => {
      authenticatedAsEmployee();
      const result = await processArcoRequest({
        requestId: VALID_UUID,
        action: "approve",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Sin permiso");
      }
      expect(mockCan).toHaveBeenCalledWith("user-emp-1", "arco.manage", "view");
    });
  });

  describe("exportUserData", () => {
    it("rejects an employee without arco.manage permission", async () => {
      authenticatedAsEmployee();
      const result = await exportUserData(VALID_UUID);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Sin permiso");
      }
      expect(mockCan).toHaveBeenCalledWith("user-emp-1", "arco.manage", "view");
    });
  });
});
