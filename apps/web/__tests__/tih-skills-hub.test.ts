import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const mockGetClaims = vi.fn();
vi.mock("@/lib/supabase/claims", () => ({
  getClaims: (...args: unknown[]) => mockGetClaims(...args),
}));

vi.mock("@/lib/authz/can", () => ({
  can: vi.fn(),
}));

vi.mock("@/lib/audit/log", () => ({
  writeAuditLog: vi.fn().mockResolvedValue("audit-id"),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));

import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/authz/can";
import {
  updateSelfAssessment,
  setManagerAssessment,
  createSkill,
  updateSkill,
  updateJobRoleSkill,
} from "../src/app/(protected)/skills-hub/actions";

const mockCan = vi.mocked(can);

const UUID_SKILL = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const UUID_SKILL_CROSS = "f1e2d3c4-b5a6-4978-8690-abcdef012345";
const UUID_USER = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const UUID_JOB_ROLE = "c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f";

function buildChain(overrides?: {
  selectData?: unknown;
  upsertResult?: { data: unknown; error: unknown };
  insertResult?: { data: unknown; error: unknown };
  updateResult?: { data: unknown; error: unknown };
  maybeSingleData?: unknown;
}) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue({
    data: overrides?.selectData ?? { id: "user-1", tenant_id: "tenant-1" },
    error: null,
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({
    data: overrides?.maybeSingleData ?? null,
    error: null,
  });
  chain.insert = vi.fn(() => {
    if (overrides?.insertResult) {
      chain.single = vi.fn().mockResolvedValue(overrides.insertResult);
      chain.select = vi.fn(() => chain);
    }
    return chain;
  });
  chain.update = vi.fn(() => {
    if (overrides?.updateResult) {
      chain.eq = vi.fn().mockResolvedValue(overrides.updateResult);
    }
    return chain;
  });
  chain.upsert = vi.fn().mockResolvedValue(
    overrides?.upsertResult ?? { data: null, error: null }
  );
  return chain;
}

function mockSupabase(options?: {
  user?: unknown;
  claims?: { userId: string; tenantId: string; email?: string; appRole?: string; aal?: string } | null;
  rpcResult?: { data: unknown; error: unknown };
  chainOverrides?: Parameters<typeof buildChain>[0];
}) {
  const defaultClaims = { userId: "auth-uid-1", tenantId: "tenant-1", email: "test@test.com", appRole: "member", aal: "aal1" };
  const claims = options && "claims" in options ? options.claims : defaultClaims;
  mockGetClaims.mockResolvedValue(claims);

  const chain = buildChain(options?.chainOverrides);

  const rpcFn = vi.fn().mockResolvedValue(
    options?.rpcResult ?? { data: null, error: null }
  );

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    from: vi.fn(() => chain),
    rpc: rpcFn,
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
  return { supabase, chain, rpcFn };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("updateSelfAssessment", () => {
  it("calls upsert_self_assessment RPC with correct params", async () => {
    const { rpcFn } = mockSupabase({ rpcResult: { data: null, error: null } });
    mockCan.mockResolvedValue({ allowed: true });

    await updateSelfAssessment({ skillId: UUID_SKILL, level: 4 });

    expect(rpcFn).toHaveBeenCalledWith("upsert_self_assessment", {
      p_skill_id: UUID_SKILL,
      p_level: 4,
    });
  });

  it("returns error when not authenticated", async () => {
    mockGetClaims.mockResolvedValue(null);

    const res = await updateSelfAssessment({ skillId: UUID_SKILL, level: 3 });
    expect(res).toEqual({ error: "No autenticado" });
  });

  it("returns error when permission denied", async () => {
    mockSupabase();
    mockCan.mockResolvedValue({ allowed: false, reason: "no_permission" });
    const res = await updateSelfAssessment({ skillId: UUID_SKILL, level: 3 });
    expect(res).toEqual({ error: "Sin permiso para evaluar habilidades" });
  });
});

describe("setManagerAssessment", () => {
  const validInput = { userId: UUID_USER, skillId: UUID_SKILL, level: 4 };

  it("succeeds when the SQL function authorizes the call", async () => {
    mockSupabase({ rpcResult: { data: null, error: null } });
    const res = await setManagerAssessment(validInput);
    expect(res).toEqual({ success: true });
  });

  it("calls set_manager_assessment RPC with correct params", async () => {
    const { rpcFn } = mockSupabase({ rpcResult: { data: null, error: null } });
    await setManagerAssessment(validInput);
    expect(rpcFn).toHaveBeenCalledWith("set_manager_assessment", {
      p_user_id: validInput.userId,
      p_skill_id: validInput.skillId,
      p_level: validInput.level,
    });
  });

  it("returns error when caller is not a manager or admin", async () => {
    mockSupabase({
      rpcResult: { data: null, error: { message: "Not authorized: not a direct manager or admin" } },
    });
    const res = await setManagerAssessment(validInput);
    expect(res).toEqual({ error: "Not authorized: not a direct manager or admin" });
  });

  it("returns error when target employee skill not found", async () => {
    mockSupabase({
      rpcResult: { data: null, error: { message: "Employee skill record not found" } },
    });
    const res = await setManagerAssessment(validInput);
    expect(res).toEqual({ error: "Employee skill record not found" });
  });
});

describe("cross-tenant FK enforcement", () => {
  it("employee_skills insert with a skill from another tenant fails", async () => {
    mockSupabase({
      rpcResult: {
        data: null,
        error: { message: 'violates foreign key constraint "es_skill_fk"' },
      },
    });
    mockCan.mockResolvedValue({ allowed: true });
    const res = await updateSelfAssessment({ skillId: UUID_SKILL_CROSS, level: 3 });
    expect(res).toHaveProperty("error");
    expect((res as { error: string }).error).toContain("foreign key constraint");
  });

  it("job_role_skills upsert with a skill from another tenant fails", async () => {
    mockSupabase({
      chainOverrides: {
        upsertResult: {
          data: null,
          error: { message: 'violates foreign key constraint "jrs_skill_fk"' },
        },
      },
    });
    mockCan.mockResolvedValue({ allowed: true });
    const res = await updateJobRoleSkill({
      jobRoleId: UUID_JOB_ROLE, skillId: UUID_SKILL_CROSS, requiredProficiencyLevel: 3,
    });
    expect(res).toHaveProperty("error");
    expect((res as { error: string }).error).toContain("foreign key constraint");
  });
});

describe("createSkill — permission gating", () => {
  const validSkill = { code: "AGILE", name: "Agile Methodology", category: "technical" as const };

  it("returns error when user lacks tih.ontology edit permission", async () => {
    mockSupabase();
    mockCan.mockResolvedValue({ allowed: false, reason: "no_permission" });
    const res = await createSkill(validSkill);
    expect(res).toEqual({ error: "Sin permiso para gestionar ontología" });
    expect(mockCan).toHaveBeenCalledWith("user-1", "tenant-1", "tih.ontology", "edit");
  });

  it("succeeds when user has admin permission", async () => {
    mockSupabase({ chainOverrides: { insertResult: { data: { id: "new-skill-id" }, error: null } } });
    mockCan.mockResolvedValue({ allowed: true });
    const res = await createSkill(validSkill);
    expect(res).toEqual({ success: true });
  });
});

describe("updateSkill — permission gating", () => {
  it("returns error when non-admin tries to update ontology", async () => {
    mockSupabase();
    mockCan.mockResolvedValue({ allowed: false, reason: "no_permission" });
    const res = await updateSkill({ skillId: UUID_SKILL, name: "New Name" });
    expect(res).toEqual({ error: "Sin permiso para gestionar ontología" });
  });
});

describe("updateJobRoleSkill — permission gating", () => {
  it("returns error when non-admin tries to edit job requirements", async () => {
    mockSupabase();
    mockCan.mockResolvedValue({ allowed: false, reason: "no_permission" });
    const res = await updateJobRoleSkill({
      jobRoleId: UUID_JOB_ROLE, skillId: UUID_SKILL, requiredProficiencyLevel: 3,
    });
    expect(res).toEqual({ error: "Sin permiso para gestionar requisitos de puesto" });
  });
});

describe("skills-hub page module gating", () => {
  it("is_tih_active defaults to false when tenant not found", async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
          })),
        })),
      })),
    });
    const { getModuleFlags } = await import("../src/lib/tenant/get-module-flags");
    const flags = await getModuleFlags("nonexistent-tenant");
    expect(flags.is_tih_active).toBe(false);
  });
});

describe("Zod validation", () => {
  beforeEach(() => {
    mockSupabase();
    mockCan.mockResolvedValue({ allowed: true });
  });

  it("updateSelfAssessment rejects level 0", async () => {
    const res = await updateSelfAssessment({ skillId: UUID_SKILL, level: 0 });
    expect(res).toHaveProperty("error");
  });

  it("updateSelfAssessment rejects level 6", async () => {
    const res = await updateSelfAssessment({ skillId: UUID_SKILL, level: 6 });
    expect(res).toHaveProperty("error");
  });

  it("updateSelfAssessment rejects non-UUID skillId", async () => {
    const res = await updateSelfAssessment({ skillId: "not-a-uuid", level: 3 });
    expect(res).toHaveProperty("error");
  });

  it("setManagerAssessment rejects non-UUID skillId", async () => {
    const res = await setManagerAssessment({ userId: UUID_USER, skillId: "not-a-uuid", level: 3 });
    expect(res).toHaveProperty("error");
  });

  it("setManagerAssessment rejects level outside 1-5", async () => {
    const res = await setManagerAssessment({ userId: UUID_USER, skillId: UUID_SKILL, level: 10 });
    expect(res).toHaveProperty("error");
  });

  it("createSkill rejects empty name", async () => {
    const res = await createSkill({ code: "TEST", name: "", category: "technical" });
    expect(res).toHaveProperty("error");
  });

  it("createSkill rejects invalid category", async () => {
    const res = await createSkill({ code: "TEST", name: "Test Skill", category: "INVALID" });
    expect(res).toHaveProperty("error");
  });

  it("updateJobRoleSkill rejects level 0", async () => {
    const res = await updateJobRoleSkill({
      jobRoleId: UUID_JOB_ROLE, skillId: UUID_SKILL, requiredProficiencyLevel: 0,
    });
    expect(res).toHaveProperty("error");
  });

  it("updateJobRoleSkill rejects level 6", async () => {
    const res = await updateJobRoleSkill({
      jobRoleId: UUID_JOB_ROLE, skillId: UUID_SKILL, requiredProficiencyLevel: 6,
    });
    expect(res).toHaveProperty("error");
  });
});
