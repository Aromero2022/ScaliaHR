import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import * as jose from "jose";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { integrationEnv } from "./helpers/env";
import { buildRow, insertRow, loadTableMeta } from "./helpers/fixtures";

/**
 * TIH RLS + RPC Integration Tests
 *
 * These tests validate real RLS policies and SECURITY DEFINER functions
 * for TIH tables (skill_ontology, employee_skills, job_role_skills)
 * against a running local Supabase instance.
 *
 * Requirements:
 *   1. supabase start
 *   2. Migrations applied (supabase db reset)
 *   3. TIH seed data from 20261023090000_rbp_tih_seeds.sql
 *
 * Environment:
 *   SUPABASE_URL=http://127.0.0.1:54321
 *   SUPABASE_ANON_KEY=<from supabase status>
 *   SUPABASE_SERVICE_ROLE_KEY=<from supabase status>
 *   SUPABASE_JWT_SECRET=<from supabase status>
 */

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  jwtSecret: JWT_SECRET,
  dbUrl: DB_URL,
} = integrationEnv();

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
afterAll(() => db.end());

function serviceClient() {
  return createSupabaseClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

async function mintJwt(payload: {
  sub: string;
  role: string;
  tenant_id?: string;
  app_metadata?: Record<string, unknown>;
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
      ...payload.app_metadata,
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
let skillId: string;
let otherTenantId: string;
let otherSkillId: string;

describe("TIH RLS Integration", () => {
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
      .limit(2);
    expect(users).toBeTruthy();
    expect(users!.length).toBeGreaterThanOrEqual(2);

    userAId = users![0].id;
    userBId = users![1].id;
    userAAuthUid = users![0].auth_uid;
    userBAuthUid = users![1].auth_uid;

    const { data: skill } = await svc
      .from("skill_ontology")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (skill) {
      skillId = skill.id;
    } else {
      const { data: newSkill } = await svc
        .from("skill_ontology")
        .insert({
          tenant_id: tenantId,
          code: "TEST_INTEG",
          name: "Integration Test Skill",
          category: "technical",
        })
        .select("id")
        .single();
      skillId = newSkill!.id;
    }

    otherTenantId = randomUUID();
    const tenantsMeta = await loadTableMeta(db, "tenants");
    await insertRow(
      db,
      tenantsMeta,
      buildRow(tenantsMeta, {
        tenantId: otherTenantId,
        authUserId: "",
        fixtures: new Map(),
        overrides: { id: otherTenantId },
      }),
      { bypassForeignKeys: false },
    );
    const { data: otherSkill, error: otherSkillError } = await svc
      .from("skill_ontology")
      .insert({
        tenant_id: otherTenantId,
        code: "TEST_OTHER_TENANT",
        name: "Other Tenant Skill",
        category: "technical",
      })
      .select("id")
      .single();
    expect(otherSkillError).toBeNull();
    otherSkillId = otherSkill!.id;
  });

  afterAll(async () => {
    if (otherTenantId) {
      await db.query("DELETE FROM public.skill_ontology WHERE tenant_id = $1", [otherTenantId]);
      await db.query("DELETE FROM public.tenants WHERE id = $1", [otherTenantId]);
    }
  });

  it("authenticated user sees only own tenant skill_ontology rows", async () => {
    const jwt = await mintJwt({
      sub: userAAuthUid,
      role: "authenticated",
      tenant_id: tenantId,
    });
    const client = authedClient(jwt);
    const { data, error } = await client
      .from("skill_ontology")
      .select("id, tenant_id");
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    for (const row of data!) {
      expect(row.tenant_id).toBe(tenantId);
    }
  });

  it("authenticated user cannot see another tenant's skills", async () => {
    const jwt = await mintJwt({
      sub: userAAuthUid,
      role: "authenticated",
      tenant_id: tenantId,
    });
    const client = authedClient(jwt);
    const { data } = await client
      .from("skill_ontology")
      .select("id, tenant_id")
      .eq("tenant_id", otherTenantId);
    expect(data).toEqual([]);
  });

  it("upsert_self_assessment RPC succeeds for own skills", async () => {
    const jwt = await mintJwt({
      sub: userAAuthUid,
      role: "authenticated",
      tenant_id: tenantId,
    });
    const client = authedClient(jwt);
    const { error } = await client.rpc("upsert_self_assessment", {
      p_skill_id: skillId,
      p_level: 3,
    });
    expect(error).toBeNull();

    const { data: verify } = await client
      .from("employee_skills")
      .select("self_assessed_level")
      .eq("user_id", userAId)
      .eq("skill_id", skillId)
      .single();
    expect(verify?.self_assessed_level).toBe(3);
  });

  it("upsert_self_assessment rejects level outside 1-5", async () => {
    const jwt = await mintJwt({
      sub: userAAuthUid,
      role: "authenticated",
      tenant_id: tenantId,
    });
    const client = authedClient(jwt);
    const { error } = await client.rpc("upsert_self_assessment", {
      p_skill_id: skillId,
      p_level: 0,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toContain("Level must be between 1 and 5");
  });

  it("employee_skills cross-tenant FK prevents inserting skill from another tenant", async () => {
    const jwt = await mintJwt({
      sub: userAAuthUid,
      role: "authenticated",
      tenant_id: tenantId,
    });
    const client = authedClient(jwt);
    const { error } = await client.rpc("upsert_self_assessment", {
      p_skill_id: otherSkillId,
      p_level: 3,
    });
    expect(error).toBeTruthy();
  });

  it("authenticated user cannot DELETE employee_skills rows", async () => {
    const jwt = await mintJwt({
      sub: userAAuthUid,
      role: "authenticated",
      tenant_id: tenantId,
    });
    const client = authedClient(jwt);
    const { error } = await client
      .from("employee_skills")
      .delete()
      .eq("user_id", userAId)
      .eq("skill_id", skillId);
    expect(error).toBeTruthy();
  });

  it("anon role cannot read skill_ontology", async () => {
    const anonClient = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data, error } = await anonClient
      .from("skill_ontology")
      .select("id")
      .limit(1);
    const blocked = error !== null || (data ?? []).length === 0;
    expect(blocked).toBe(true);
  });

  it("get_direct_reports RPC returns expected results for a manager", async () => {
    const svc = serviceClient();

    const { data: managerJob } = await svc
      .from("ec_job_information")
      .select("user_id, manager_id")
      .not("manager_id", "is", null)
      .limit(1)
      .maybeSingle();
    expect(managerJob, "seed data has no ec_job_information row with a manager").toBeTruthy();

    const { data: manager } = await svc
      .from("users")
      .select("auth_uid, tenant_id")
      .eq("id", managerJob!.manager_id)
      .single();
    expect(manager, "manager user not found").toBeTruthy();

    const jwt = await mintJwt({
      sub: manager!.auth_uid,
      role: "authenticated",
      tenant_id: manager!.tenant_id,
    });
    const client = authedClient(jwt);
    const { data: reports, error } = await client.rpc("get_direct_reports");
    expect(error).toBeNull();
    expect(reports).toBeTruthy();
    const reportIds = (reports ?? []).map((r: { user_id: string }) => r.user_id);
    expect(reportIds).toContain(managerJob!.user_id);
  });
});

describe("TIH catalog verification", () => {
  const TIH_TABLES = ["skill_ontology", "job_role_skills", "employee_skills"];
  const TIH_DEFINER_FUNCTIONS = [
    "upsert_self_assessment",
    "set_manager_assessment",
    "get_direct_reports",
  ];

  it("FORCE RLS is enabled on all TIH tables", async () => {
    const { rows } = await db.query<{ relname: string; enabled: boolean; forced: boolean }>(
      `SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) ORDER BY c.relname`,
      [TIH_TABLES],
    );
    expect(rows).toEqual(
      [...TIH_TABLES].sort().map((relname) => ({ relname, enabled: true, forced: true })),
    );
  });

  it.each(TIH_DEFINER_FUNCTIONS)("%s is SECURITY DEFINER with empty search_path", async (fn) => {
    const { rows } = await db.query<{ definer: boolean; config: string[] | null }>(
      `SELECT p.prosecdef AS definer, p.proconfig AS config
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = $1`,
      [fn],
    );
    expect(rows.length, `${fn} not found`).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.definer).toBe(true);
      expect(row.config ?? []).toContain('search_path=""');
    }
  });

  it("no DELETE policy exists for authenticated on TIH tables", async () => {
    const { rows } = await db.query<{ tablename: string; policyname: string }>(
      `SELECT tablename, policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])
         AND cmd IN ('DELETE', 'ALL') AND permissive = 'PERMISSIVE'
         AND roles && ARRAY['authenticated', 'public']::name[]`,
      [TIH_TABLES],
    );
    expect(rows).toEqual([]);
  });
});
