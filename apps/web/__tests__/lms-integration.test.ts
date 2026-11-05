import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/lms/moodle-client", () => ({
  createUser: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  requestLoginUrl: vi.fn(),
  enrolUser: vi.fn(),
  createCategory: vi.fn(),
  createCohort: vi.fn(),
  addCohortMembers: vi.fn(),
  removeCohortMembers: vi.fn(),
  getActivitiesCompletion: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import * as moodleClient from "@/lib/lms/moodle-client";
import { syncLmsUsers, getEmployeeCompletions } from "@/lib/jobs/lms-sync";
import { provisionTenantLms } from "@/lib/lms/provision-tenant";

const mockMoodle = vi.mocked(moodleClient);

const TENANT_A = "a0000000-0000-0000-0000-000000000001";
const TENANT_B = "b0000000-0000-0000-0000-000000000002";
const USER_1 = "e0000000-0000-0000-0000-000000000001";
const USER_2 = "e0000000-0000-0000-0000-000000000002";

const REPO_ROOT = path.resolve(__dirname, "../../..");

type QR = { data: unknown; error: unknown };

function setupSupabase(fromResults: QR[]) {
  let idx = 0;

  function makeChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    const resolve = () => {
      const r = fromResults[idx] ?? { data: null, error: null };
      idx++;
      return Promise.resolve(r);
    };

    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.single = vi.fn(resolve);
    chain.insert = vi.fn(resolve);
    chain.then = (onfulfilled: (v: QR) => unknown) => resolve().then(onfulfilled);
    return chain;
  }

  const from = vi.fn(() => makeChain());
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from });
  return from;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════
// 1. Tenant Provisioning
// ═══════════════════════════════════════════════════════════════════

describe("provisionTenantLms", () => {
  it("creates category and cohort in Moodle, stores mapping", async () => {
    setupSupabase([
      { data: null, error: null },
      { data: null, error: null },
    ]);

    mockMoodle.createCategory.mockResolvedValue({ id: 101, name: "Acme — Formación" });
    mockMoodle.createCohort.mockResolvedValue({ id: 201, name: "Acme — Empleados" });

    const result = await provisionTenantLms(TENANT_A, "Acme Corp");

    expect(result.alreadyProvisioned).toBe(false);
    expect(result.categoryId).toBe(101);
    expect(result.cohortId).toBe(201);
    expect(mockMoodle.createCategory).toHaveBeenCalledWith("Acme Corp — Formación");
    expect(mockMoodle.createCohort).toHaveBeenCalledWith(
      "Acme Corp — Empleados",
      `tenant_${TENANT_A}`
    );
  });

  it("skips if tenant already provisioned", async () => {
    setupSupabase([{ data: { id: "existing" }, error: null }]);

    const result = await provisionTenantLms(TENANT_A, "Acme Corp");

    expect(result.alreadyProvisioned).toBe(true);
    expect(mockMoodle.createCategory).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. User Provisioning (via sync)
// ═══════════════════════════════════════════════════════════════════

describe("syncLmsUsers — provisioning", () => {
  it("provisions active employees not yet in Moodle", async () => {
    setupSupabase([
      // 1: lms_tenant_map.single()
      { data: { moodle_category_id: 101, moodle_cohort_id: 201 }, error: null },
      // 2: users.select().eq() → awaited directly (thenable)
      {
        data: [
          { id: USER_1, auth_uid: USER_1, email: "elena@acme.dev", first_name: "Elena", last_name: "Martinez", status: "ACTIVE", is_anonymized: false },
        ],
        error: null,
      },
      // 3: lms_user_map.select().eq() → awaited directly
      { data: [], error: null },
      // 4: lms_user_map.insert()
      { data: null, error: null },
    ]);

    mockMoodle.getUser.mockResolvedValue(null);
    mockMoodle.createUser.mockResolvedValue({ id: 501, username: USER_1, email: "elena@acme.dev" });

    const result = await syncLmsUsers(TENANT_A);

    expect(result.provisioned).toBe(1);
    expect(mockMoodle.createUser).toHaveBeenCalledWith({
      username: USER_1,
      email: "elena@acme.dev",
      firstName: "Elena",
      lastName: "Martinez",
    });
    expect(mockMoodle.addCohortMembers).toHaveBeenCalledWith(201, [501]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. SSO Launch
// ═══════════════════════════════════════════════════════════════════

describe("moodle-client SSO", () => {
  it("requestLoginUrl calls the right WS function", async () => {
    mockMoodle.requestLoginUrl.mockResolvedValue(
      "https://moodle.local/auth/userkey/login.php?key=abc123"
    );

    const url = await mockMoodle.requestLoginUrl(USER_1);

    expect(url).toContain("auth/userkey/login.php");
    expect(mockMoodle.requestLoginUrl).toHaveBeenCalledWith(USER_1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Enrolment
// ═══════════════════════════════════════════════════════════════════

describe("enrolment", () => {
  it("enrols a Moodle user in a course", async () => {
    mockMoodle.enrolUser.mockResolvedValue(undefined);

    await mockMoodle.enrolUser(501, 1001, 5);

    expect(mockMoodle.enrolUser).toHaveBeenCalledWith(501, 1001, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Suspension on Termination
// ═══════════════════════════════════════════════════════════════════

describe("syncLmsUsers — suspension", () => {
  it("suspends terminated employees in Moodle", async () => {
    setupSupabase([
      { data: { moodle_category_id: 101, moodle_cohort_id: 201 }, error: null },
      {
        data: [
          { id: USER_2, auth_uid: USER_2, email: "carlos@acme.dev", first_name: "Carlos", last_name: "Lopez", status: "TERMINATED", is_anonymized: false },
        ],
        error: null,
      },
      {
        data: [{ user_id: USER_2, moodle_user_id: 502 }],
        error: null,
      },
    ]);

    const result = await syncLmsUsers(TENANT_A);

    expect(result.suspended).toBe(1);
    expect(mockMoodle.updateUser).toHaveBeenCalledWith(502, { suspended: 1 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. ARCO Anonymization in Moodle
// ═══════════════════════════════════════════════════════════════════

describe("syncLmsUsers — ARCO anonymization", () => {
  it("anonymizes user data in Moodle when is_anonymized=true", async () => {
    setupSupabase([
      { data: { moodle_category_id: 101, moodle_cohort_id: 201 }, error: null },
      {
        data: [
          { id: USER_1, auth_uid: USER_1, email: "elena@acme.dev", first_name: "Elena", last_name: "Martinez", status: "ACTIVE", is_anonymized: true },
        ],
        error: null,
      },
      {
        data: [{ user_id: USER_1, moodle_user_id: 501 }],
        error: null,
      },
    ]);

    const result = await syncLmsUsers(TENANT_A);

    expect(result.anonymized).toBe(1);
    expect(mockMoodle.updateUser).toHaveBeenCalledWith(501, {
      suspended: 1,
      firstname: "Usuario",
      lastname: "Anonimizado",
      email: `anon_${USER_1}@scalia.local`,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Tenant Isolation (Tenant A ≠ Tenant B)
// ═══════════════════════════════════════════════════════════════════

describe("tenant isolation", () => {
  it("sync only provisions users for the given tenant", async () => {
    setupSupabase([
      { data: { moodle_category_id: 301, moodle_cohort_id: 401 }, error: null },
      {
        data: [
          { id: "userB1", auth_uid: "userB1", email: "user@tenantB.dev", first_name: "Test", last_name: "User", status: "ACTIVE", is_anonymized: false },
        ],
        error: null,
      },
      { data: [], error: null },
      { data: null, error: null },
    ]);

    mockMoodle.getUser.mockResolvedValue(null);
    mockMoodle.createUser.mockResolvedValue({ id: 601, username: "userB1", email: "user@tenantB.dev" });

    const result = await syncLmsUsers(TENANT_B);

    expect(result.provisioned).toBe(1);
    expect(mockMoodle.addCohortMembers).toHaveBeenCalledWith(401, [601]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Completion Reading
// ═══════════════════════════════════════════════════════════════════

describe("getEmployeeCompletions", () => {
  it("fetches activity completion for a mapped user", async () => {
    setupSupabase([
      { data: { moodle_user_id: 501 }, error: null },
    ]);

    mockMoodle.getActivitiesCompletion.mockResolvedValue([
      { cmid: 1, modname: "quiz", state: 1, timecompleted: 1700000000 },
    ]);

    const completions = await getEmployeeCompletions(TENANT_A, USER_1, 1001);

    expect(completions).toHaveLength(1);
    expect(completions[0].state).toBe(1);
    expect(mockMoodle.getActivitiesCompletion).toHaveBeenCalledWith(1001, 501);
  });

  it("returns empty array when user is not mapped", async () => {
    setupSupabase([{ data: null, error: null }]);

    const completions = await getEmployeeCompletions(TENANT_A, USER_1, 1001);

    expect(completions).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Token Leak Check (static analysis equivalent)
// ═══════════════════════════════════════════════════════════════════

describe("MOODLE_WS_TOKEN never in client bundle", () => {
  it("moodle-client.ts has a server-only guard", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/lib/lms/moodle-client.ts"),
      "utf-8"
    );
    // D30: the server-only marker makes a client import fail the build.
    expect(content).toMatch(/^import "server-only";$/m);
  });

  it("check:forbidden includes MOODLE_WS_TOKEN", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      path.join(REPO_ROOT, "scripts/check-forbidden.sh"),
      "utf-8"
    );
    expect(content).toContain("MOODLE_WS_TOKEN");
  });

  it("MOODLE_WS_TOKEN is not in any client-side file", async () => {
    const { execSync } = await import("child_process");
    const result = execSync(
      `grep -rn "MOODLE_WS_TOKEN" "${path.join(REPO_ROOT, "apps/web/src")}" --include="*.tsx" --include="*.ts" || true`,
      { encoding: "utf-8" }
    );
    const clientFiles = result
      .split("\n")
      .filter((line) => line.trim())
      .filter(
        (line) =>
          !line.includes("moodle-client.ts") &&
          !line.includes("lms-sync.ts") &&
          !line.includes("provision-tenant.ts") &&
          !line.includes("route.ts") &&
          !line.includes("lms-integration.test.ts")
      );
    expect(clientFiles).toHaveLength(0);
  });
});
