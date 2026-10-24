import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQueryRaw = vi.fn();

vi.mock("@/lib/db/tenant-client", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
  },
}));

import { can, clearCanCache } from "@/lib/authz/can";

const USER_A = "user-a";
const USER_B = "user-b";
const ROLE_1 = "role-1";

let queryCallIndex = 0;

function setupQuerySequence(
  ...responses: unknown[][]
) {
  queryCallIndex = 0;
  mockQueryRaw.mockImplementation(() => {
    const result = responses[queryCallIndex] ?? [];
    queryCallIndex++;
    return Promise.resolve(result);
  });
}

describe("can()", () => {
  beforeEach(() => {
    clearCanCache();
    vi.clearAllMocks();
    queryCallIndex = 0;
  });

  it("denies when user has no group membership", async () => {
    setupQuerySequence(
      [],
    );
    const result = await can(USER_A, "employee.view", "view");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("no_group_membership");
  });

  it("denies when no matching permissions exist", async () => {
    setupQuerySequence(
      [{ role_id: ROLE_1, target_population: "all" }],
      [],
    );
    const result = await can(USER_A, "employee.view", "view");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("no_permission");
  });

  describe("target_population: all", () => {
    it("allows access to any target user", async () => {
      setupQuerySequence(
        [{ role_id: ROLE_1, target_population: "all" }],
        [{ role_id: ROLE_1 }],
      );
      const result = await can(USER_A, "employee.view", "view", USER_B);
      expect(result.allowed).toBe(true);
    });

    it("allows access when no target is specified", async () => {
      setupQuerySequence(
        [{ role_id: ROLE_1, target_population: "all" }],
        [{ role_id: ROLE_1 }],
      );
      const result = await can(USER_A, "employee.view", "view");
      expect(result.allowed).toBe(true);
    });
  });

  describe("target_population: self", () => {
    it("allows when target is the actor", async () => {
      setupQuerySequence(
        [{ role_id: ROLE_1, target_population: "self" }],
        [{ role_id: ROLE_1 }],
      );
      const result = await can(USER_A, "employee.view", "view", USER_A);
      expect(result.allowed).toBe(true);
    });

    it("denies when target is a different user", async () => {
      setupQuerySequence(
        [{ role_id: ROLE_1, target_population: "self" }],
        [{ role_id: ROLE_1 }],
      );
      const result = await can(USER_A, "employee.view", "view", USER_B);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("target_population_mismatch");
    });
  });

  describe("target_population: same_department", () => {
    it("allows when actor and target share a department", async () => {
      setupQuerySequence(
        [{ role_id: ROLE_1, target_population: "same_department" }],
        [{ role_id: ROLE_1 }],
        [{ match: true }],
      );
      const result = await can(USER_A, "employee.view", "view", USER_B);
      expect(result.allowed).toBe(true);
    });

    it("denies when actor and target are in different departments", async () => {
      setupQuerySequence(
        [{ role_id: ROLE_1, target_population: "same_department" }],
        [{ role_id: ROLE_1 }],
        [{ match: false }],
      );
      const result = await can(USER_A, "employee.view", "view", USER_B);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("target_population_mismatch");
    });

    it("denies when either user has no department", async () => {
      setupQuerySequence(
        [{ role_id: ROLE_1, target_population: "same_department" }],
        [{ role_id: ROLE_1 }],
        [],
      );
      const result = await can(USER_A, "employee.view", "view", USER_B);
      expect(result.allowed).toBe(false);
    });
  });

  describe("target_population: direct_reports", () => {
    it("allows when target's manager_id matches actor", async () => {
      setupQuerySequence(
        [{ role_id: ROLE_1, target_population: "direct_reports" }],
        [{ role_id: ROLE_1 }],
        [{ manager_id: USER_A }],
      );
      const result = await can(USER_A, "employee.view", "view", USER_B);
      expect(result.allowed).toBe(true);
    });

    it("denies when target's manager is someone else", async () => {
      setupQuerySequence(
        [{ role_id: ROLE_1, target_population: "direct_reports" }],
        [{ role_id: ROLE_1 }],
        [{ manager_id: "other-manager" }],
      );
      const result = await can(USER_A, "employee.view", "view", USER_B);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("target_population_mismatch");
    });

    it("denies when target has no manager", async () => {
      setupQuerySequence(
        [{ role_id: ROLE_1, target_population: "direct_reports" }],
        [{ role_id: ROLE_1 }],
        [{ manager_id: null }],
      );
      const result = await can(USER_A, "employee.view", "view", USER_B);
      expect(result.allowed).toBe(false);
    });
  });

  describe("caching", () => {
    it("returns cached result on repeated calls with same args", async () => {
      setupQuerySequence(
        [{ role_id: ROLE_1, target_population: "all" }],
        [{ role_id: ROLE_1 }],
      );
      await can(USER_A, "employee.view", "view");
      await can(USER_A, "employee.view", "view");

      expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    });

    it("evaluates separately for different permission keys", async () => {
      setupQuerySequence(
        [{ role_id: ROLE_1, target_population: "all" }],
        [{ role_id: ROLE_1 }],
      );
      await can(USER_A, "employee.view", "view");

      clearCanCache();
      setupQuerySequence(
        [{ role_id: ROLE_1, target_population: "all" }],
        [{ role_id: ROLE_1 }],
      );
      await can(USER_A, "compensation.view", "view");

      expect(mockQueryRaw).toHaveBeenCalledTimes(4);
    });
  });
});
