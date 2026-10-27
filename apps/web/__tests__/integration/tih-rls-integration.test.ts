import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

/**
 * TIH RLS + RPC Integration Tests
 *
 * Real RLS policies and SECURITY DEFINER functions for TIH tables
 * (skill_ontology, employee_skills, job_role_skills), with tenants, users
 * and skills created by this suite.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

let tenant: TestTenant;
let otherTenant: TestTenant;
let skillId: string;
let otherSkillId: string;

async function createSkill(tenantId: string, code: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.skill_ontology (id, tenant_id, code, name, category)
     VALUES ($1, $2, $3, $4, 'technical')`,
    [id, tenantId, code, `Skill ${code}`],
  );
  return id;
}

beforeAll(async () => {
  tenant = await world.createTenant();
  otherTenant = await world.createTenant();
  skillId = await createSkill(tenant.id, "IT_OWN");
  otherSkillId = await createSkill(otherTenant.id, "IT_OTHER");
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

describe("TIH RLS Integration", () => {
  it("authenticated user sees only own tenant skill_ontology rows", async () => {
    const { data, error } = await tenant.employee.client.from("skill_ontology").select("id, tenant_id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toContain(skillId);
    for (const row of data ?? []) expect(row.tenant_id).toBe(tenant.id);
  });

  it("authenticated user cannot see another tenant's skills", async () => {
    const { data, error } = await tenant.employee.client
      .from("skill_ontology")
      .select("id")
      .eq("tenant_id", otherTenant.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("upsert_self_assessment RPC succeeds for own skills", async () => {
    const { error } = await tenant.employee.client.rpc("upsert_self_assessment", {
      p_skill_id: skillId,
      p_level: 3,
    });
    expect(error).toBeNull();

    const { data: verify } = await tenant.employee.client
      .from("employee_skills")
      .select("self_assessed_level")
      .eq("user_id", tenant.employee.userId)
      .eq("skill_id", skillId)
      .single();
    expect(verify?.self_assessed_level).toBe(3);
  });

  it("upsert_self_assessment rejects level outside 1-5", async () => {
    const { error } = await tenant.employee.client.rpc("upsert_self_assessment", {
      p_skill_id: skillId,
      p_level: 0,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toContain("Level must be between 1 and 5");
  });

  it("employee_skills cross-tenant FK prevents assessing a skill from another tenant", async () => {
    const { error } = await tenant.employee.client.rpc("upsert_self_assessment", {
      p_skill_id: otherSkillId,
      p_level: 3,
    });
    expect(error).toBeTruthy();
    const { rows } = await db.query(
      "SELECT 1 FROM public.employee_skills WHERE skill_id = $1",
      [otherSkillId],
    );
    expect(rows).toEqual([]);
  });

  it("the direct manager can set a manager assessment, a peer cannot", async () => {
    const byManager = await tenant.manager.client.rpc("set_manager_assessment", {
      p_user_id: tenant.employee.userId,
      p_skill_id: skillId,
      p_level: 4,
    });
    expect(byManager.error).toBeNull();

    const byPeer = await tenant.employee.client.rpc("set_manager_assessment", {
      p_user_id: tenant.manager.userId,
      p_skill_id: skillId,
      p_level: 2,
    });
    expect(byPeer.error?.message).toContain("Not authorized");
  });

  it("authenticated user cannot DELETE employee_skills rows", async () => {
    const { error } = await tenant.employee.client
      .from("employee_skills")
      .delete()
      .eq("user_id", tenant.employee.userId)
      .eq("skill_id", skillId);
    if (error) expect(error.code).toBe("42501");
    const { rows } = await db.query(
      "SELECT 1 FROM public.employee_skills WHERE user_id = $1 AND skill_id = $2",
      [tenant.employee.userId, skillId],
    );
    expect(rows.length).toBe(1);
  });

  it("anon role cannot read skill_ontology", async () => {
    const { data, error } = await world.anon.from("skill_ontology").select("id").limit(1);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("get_direct_reports returns the manager's direct reports only", async () => {
    const { data, error } = await tenant.manager.client.rpc("get_direct_reports");
    expect(error).toBeNull();
    expect((data ?? []).map((r: { user_id: string }) => r.user_id)).toEqual([tenant.employee.userId]);

    const none = await tenant.employee.client.rpc("get_direct_reports");
    expect(none.error).toBeNull();
    expect(none.data).toEqual([]);
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
      `SELECT c.relname::text AS relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
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
      `SELECT tablename::text, policyname::text FROM pg_policies
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])
         AND cmd IN ('DELETE', 'ALL') AND permissive = 'PERMISSIVE'
         AND roles && ARRAY['authenticated', 'public']::name[]`,
      [TIH_TABLES],
    );
    expect(rows).toEqual([]);
  });
});
