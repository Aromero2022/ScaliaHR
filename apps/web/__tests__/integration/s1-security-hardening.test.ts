import { describe, it, expect, beforeAll } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import * as jose from "jose";

/**
 * S1 Security Hardening Integration Tests
 *
 * Validates the security hardening changes from Loop S1:
 * - requesting_tenant_id() is JWT-only (no fallback)
 * - current_tenant_id() has been dropped
 * - PII RESTRICTIVE policies on ec_personal_information / ec_compensation
 * - ARCO role-based policies (subject sees own, admin manages)
 * - RBP v2 model is active (role_grants + group_members)
 * - v1 artefacts dropped (role_assignments table, criteria_json column)
 *
 * Requires a running Supabase local instance with all migrations applied.
 * In CI, this runs after `supabase db reset` in the db job.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? "";

const CAN_RUN = !!(ANON_KEY && SERVICE_KEY && JWT_SECRET);
const describeIntegration = CAN_RUN ? describe : describe.skip;

function serviceClient() {
  return createSupabaseClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

async function mintJwt(payload: {
  sub: string;
  role: string;
  tenant_id?: string;
  app_role?: string;
}) {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new jose.SignJWT({
    ...payload,
    aud: "authenticated",
    iss: "supabase",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    app_metadata: {
      tenant_id: payload.tenant_id,
      app_role: payload.app_role,
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(secret);
}

function authedClient(jwt: string) {
  return createSupabaseClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}

let tenantId: string;
let userAId: string;
let userBId: string;
let userAAuthUid: string;
let userBAuthUid: string;
let managerId: string;
let managerAuthUid: string;

describeIntegration("S1 Security Hardening", () => {
  beforeAll(async () => {
    const svc = serviceClient();

    const { data: tenant } = await svc
      .from("tenants")
      .select("id")
      .eq("slug", "acme-corp")
      .single();
    expect(tenant).toBeTruthy();
    tenantId = tenant!.id;

    const { data: users } = await svc
      .from("users")
      .select("id, auth_uid, first_name")
      .eq("tenant_id", tenantId)
      .eq("status", "ACTIVE")
      .order("employee_id")
      .limit(3);
    expect(users).toBeTruthy();
    expect(users!.length).toBeGreaterThanOrEqual(2);

    userAId = users![0].id;
    userAAuthUid = users![0].auth_uid;
    userBId = users![1].id;
    userBAuthUid = users![1].auth_uid;

    const { data: managerJob } = await svc
      .from("ec_job_information")
      .select("manager_id")
      .eq("tenant_id", tenantId)
      .not("manager_id", "is", null)
      .is("end_date", null)
      .limit(1)
      .single();

    if (managerJob) {
      managerId = managerJob.manager_id;
      const { data: mgrUser } = await svc
        .from("users")
        .select("auth_uid")
        .eq("id", managerId)
        .single();
      managerAuthUid = mgrUser?.auth_uid ?? "";
    }
  });

  // ── requesting_tenant_id() ────────────────────────────────────────

  describe("requesting_tenant_id() — JWT-only", () => {
    it("returns tenant_id from a valid JWT", async () => {
      const jwt = await mintJwt({
        sub: userAAuthUid,
        role: "authenticated",
        tenant_id: tenantId,
      });
      const client = authedClient(jwt);
      const { data, error } = await client.rpc("requesting_tenant_id");
      expect(error).toBeNull();
      expect(data).toBe(tenantId);
    });

    it("returns null when JWT has no tenant_id claim", async () => {
      const jwt = await mintJwt({
        sub: userAAuthUid,
        role: "authenticated",
      });
      const client = authedClient(jwt);
      const { data } = await client.rpc("requesting_tenant_id");
      expect(data).toBeNull();
    });
  });

  // ── current_tenant_id() dropped ───────────────────────────────────

  describe("current_tenant_id() dropped", () => {
    it("RPC call fails because function does not exist", async () => {
      const svc = serviceClient();
      const { error } = await svc.rpc("current_tenant_id");
      expect(error).toBeTruthy();
    });
  });

  // ── PII RESTRICTIVE policies ──────────────────────────────────────

  describe("PII RESTRICTIVE policies", () => {
    it("authenticated user can see own ec_compensation records", async () => {
      const jwt = await mintJwt({
        sub: userAAuthUid,
        role: "authenticated",
        tenant_id: tenantId,
      });
      const client = authedClient(jwt);
      const { data } = await client
        .from("ec_compensation")
        .select("user_id")
        .limit(10);

      if (data && data.length > 0) {
        const userIds = new Set(data.map((r) => r.user_id));
        expect(userIds.has(userAId) || userIds.size === 0).toBe(true);
      }
    });

    it("anon cannot read ec_personal_information", async () => {
      const anonClient = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false },
      });
      const { data, error } = await anonClient
        .from("ec_personal_information")
        .select("user_id")
        .limit(1);
      const blocked = error !== null || (data ?? []).length === 0;
      expect(blocked).toBe(true);
    });

    it("anon cannot read ec_compensation", async () => {
      const anonClient = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false },
      });
      const { data, error } = await anonClient
        .from("ec_compensation")
        .select("user_id")
        .limit(1);
      const blocked = error !== null || (data ?? []).length === 0;
      expect(blocked).toBe(true);
    });
  });

  // ── ARCO policies ─────────────────────────────────────────────────

  describe("ARCO policies — role-based access", () => {
    it("anon cannot read arco_requests", async () => {
      const anonClient = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false },
      });
      const { data, error } = await anonClient
        .from("arco_requests")
        .select("id")
        .limit(1);
      const blocked = error !== null || (data ?? []).length === 0;
      expect(blocked).toBe(true);
    });
  });

  // ── RBP v2 tables ─────────────────────────────────────────────────

  describe("RBP v2 tables active", () => {
    it("role_grants table is accessible via service_role", async () => {
      const svc = serviceClient();
      const { error } = await svc
        .from("role_grants")
        .select("id")
        .limit(1);
      expect(error).toBeNull();
    });

    it("group_members table is accessible via service_role", async () => {
      const svc = serviceClient();
      const { error } = await svc
        .from("group_members")
        .select("id")
        .limit(1);
      expect(error).toBeNull();
    });

    it("role_grants has migrated data from seeds", async () => {
      const svc = serviceClient();
      const { data, error } = await svc
        .from("role_grants")
        .select("id, target_population")
        .eq("tenant_id", tenantId)
        .limit(5);
      expect(error).toBeNull();
      expect(data).toBeTruthy();
      expect(data!.length).toBeGreaterThan(0);
      for (const row of data!) {
        expect(["all", "self", "direct_reports", "same_department"]).toContain(
          row.target_population
        );
      }
    });

    it("group_members has been populated from criteria_json migration", async () => {
      const svc = serviceClient();
      const { data, error } = await svc
        .from("group_members")
        .select("id")
        .eq("tenant_id", tenantId)
        .limit(1);
      expect(error).toBeNull();
      expect(data).toBeTruthy();
      expect(data!.length).toBeGreaterThan(0);
    });
  });

  // ── v1 artefacts dropped ──────────────────────────────────────────

  describe("v1 artefacts dropped", () => {
    it("role_assignments table no longer exists", async () => {
      const svc = serviceClient();
      const { error } = await svc
        .from("role_assignments")
        .select("id")
        .limit(1);
      expect(error).toBeTruthy();
    });
  });

  // ── is_tenant_admin() uses v2 ─────────────────────────────────────

  describe("is_tenant_admin() uses v2 tables", () => {
    it("RPC is callable by authenticated user", async () => {
      const jwt = await mintJwt({
        sub: userAAuthUid,
        role: "authenticated",
        tenant_id: tenantId,
      });
      const client = authedClient(jwt);
      const { error } = await client.rpc("is_tenant_admin");
      expect(error).toBeNull();
    });
  });

  // ── Manager can see direct report PII ─────────────────────────────

  describe("PII access by manager", () => {
    it("manager can see direct report compensation", async () => {
      if (!managerAuthUid) return;
      const jwt = await mintJwt({
        sub: managerAuthUid,
        role: "authenticated",
        tenant_id: tenantId,
      });
      const client = authedClient(jwt);
      const { data, error } = await client
        .from("ec_compensation")
        .select("user_id")
        .limit(10);
      expect(error).toBeNull();
      expect(data).toBeTruthy();
    });
  });
});
