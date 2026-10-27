import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import {
  buildRow,
  insertRow,
  loadTableMeta,
  orderByDependencies,
  tenantScopedTables,
  type Row,
  type StoredFixture,
  type TableMeta,
} from "./helpers/fixtures";
import { claimsOf, TestWorld, type TestTenant } from "./helpers/world";

/**
 * Generic tenant-isolation suite.
 *
 * Every public table with a tenant_id column is discovered from the catalog,
 * so new tables are covered without touching this file. Users are real auth
 * users that sign in with a password; their tenant claim comes from
 * custom_access_token_hook. The attacker (A) is a tenant admin under RBP v2.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const TABLES = await tenantScopedTables(db);
const world = new TestWorld(env, db);
const { svc, anon } = world;

const REAL_ROW_TABLES = new Set(["users", "user_tenant_memberships"]);

interface TenantCtx {
  tenantId: string;
  authUserId: string;
  fixtures: Map<string, StoredFixture>;
  world: TestTenant;
}

const metas = new Map<string, TableMeta>();
let tenantA: TenantCtx;
let tenantB: TenantCtx;
let noTenantUserId: string;
let tokenA: string;
let tokenB: string;
let tokenNoTenant: string;
let asA: SupabaseClient;
let asNoTenant: SupabaseClient;

async function meta(table: string): Promise<TableMeta> {
  if (!metas.has(table)) metas.set(table, await loadTableMeta(db, table));
  return metas.get(table)!;
}

async function storedRow(table: string, where: string, params: unknown[]): Promise<StoredFixture> {
  const { rows } = await db.query<StoredFixture>(
    `SELECT t.ctid::text AS ctid, to_jsonb(t) AS row FROM public."${table}" t WHERE ${where}`,
    params,
  );
  if (rows.length !== 1) throw new Error(`expected one ${table} row for ${where}, got ${rows.length}`);
  return rows[0];
}

async function toCtx(t: TestTenant): Promise<TenantCtx> {
  const fixtures = new Map<string, StoredFixture>();
  fixtures.set("users", await storedRow("users", "id = $1", [t.admin.userId]));
  fixtures.set(
    "user_tenant_memberships",
    await storedRow("user_tenant_memberships", "user_id = $1 AND tenant_id = $2", [t.admin.authId, t.id]),
  );
  return { tenantId: t.id, authUserId: t.admin.authId, fixtures, world: t };
}

async function createFixtures(ctx: TenantCtx) {
  const tableMetas: TableMeta[] = [];
  for (const table of TABLES) tableMetas.push(await meta(table));
  const ordered = orderByDependencies(tableMetas);
  for (const tableMeta of ordered) {
    if (REAL_ROW_TABLES.has(tableMeta.name)) continue;
    ctx.fixtures.set(
      tableMeta.name,
      await insertRow(db, tableMeta, buildRow(tableMeta, ctx), { bypassForeignKeys: true }),
    );
  }
}

async function countTenantRows(table: string, tenantId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public."${table}" WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows[0].n;
}

async function fixtureIntact(table: string, ctx: TenantCtx): Promise<boolean> {
  const fixture = ctx.fixtures.get(table)!;
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public."${table}" WHERE ctid = $1::tid AND tenant_id = $2`,
    [fixture.ctid, ctx.tenantId],
  );
  return rows[0].n === 1;
}

async function activeTenantOf(authId: string): Promise<string | null> {
  const { rows } = await db.query<{ active_tenant_id: string | null }>(
    "SELECT active_tenant_id FROM public.user_settings WHERE user_id = $1",
    [authId],
  );
  return rows[0]?.active_tenant_id ?? null;
}

function expectDeniedOrEmpty(
  result: { data: unknown[] | null; error: PostgrestError | null },
  context: string,
) {
  if (result.error) {
    expect(result.error.code, `${context}: ${result.error.message}`).toBe("42501");
    return;
  }
  expect(result.data, context).toEqual([]);
}

function expectDeniedOrNoop(error: PostgrestError | null, context: string) {
  if (error) expect(error.code, `${context}: ${error.message}`).toBe("42501");
}

beforeAll(async () => {
  expect(TABLES.length, "no public tables with tenant_id were found").toBeGreaterThan(0);

  const a = await world.createTenant();
  const b = await world.createTenant({ activeTenantSetting: false });
  tenantA = await toCtx(a);
  tenantB = await toCtx(b);
  const noTenant = await world.userWithoutTenant();
  noTenantUserId = noTenant.authId;
  tokenNoTenant = noTenant.token;
  asNoTenant = noTenant.client;

  await createFixtures(tenantA);
  await createFixtures(tenantB);

  tokenA = a.admin.token;
  tokenB = b.admin.token;
  asA = a.admin.client;
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

describe("custom_access_token_hook", () => {
  it("runs without error when called directly", async () => {
    const { rows } = await db.query<{ claims: Record<string, unknown> }>(
      `SELECT public.custom_access_token_hook(
         jsonb_build_object('user_id', $1::text, 'claims', jsonb_build_object('sub', $1::text))
       ) -> 'claims' AS claims`,
      [tenantA.authUserId],
    );
    expect(rows[0].claims.tenant_id).toBe(tenantA.tenantId);
    expect(rows[0].claims.app_role).toBe("admin");
  });

  it("injects tenant_id from user_settings.active_tenant_id", () => {
    expect(claimsOf(tokenA).tenant_id).toBe(tenantA.tenantId);
  });

  it("falls back to the first active membership when no active tenant is set", () => {
    expect(claimsOf(tokenB).tenant_id).toBe(tenantB.tenantId);
  });

  it("gives a user without memberships no tenant", () => {
    expect([undefined, null, ""]).toContain(claimsOf(tokenNoTenant).tenant_id);
  });

  it("a user cannot point active_tenant_id at a tenant without membership", async () => {
    const employee = tenantA.world.employee;
    const { error } = await employee.client
      .from("user_settings")
      .update({ active_tenant_id: tenantB.tenantId })
      .eq("user_id", employee.authId);
    expectDeniedOrNoop(error, "update of user_settings.active_tenant_id");
    expect(await activeTenantOf(employee.authId)).toBe(tenantA.tenantId);

    const inserted = await asNoTenant
      .from("user_settings")
      .insert({ user_id: noTenantUserId, active_tenant_id: tenantB.tenantId });
    expectDeniedOrNoop(inserted.error, "insert of user_settings.active_tenant_id");
    expect(await activeTenantOf(noTenantUserId)).toBeNull();
  });

  it("ignores an active_tenant_id the user has no active membership in", async () => {
    const manager = tenantA.world.manager;
    await db.query("UPDATE public.user_settings SET active_tenant_id = $1 WHERE user_id = $2", [
      tenantB.tenantId,
      manager.authId,
    ]);
    try {
      const token = await world.signIn(manager.email);
      expect(claimsOf(token).tenant_id).toBe(tenantA.tenantId);
    } finally {
      await db.query("UPDATE public.user_settings SET active_tenant_id = $1 WHERE user_id = $2", [
        tenantA.tenantId,
        manager.authId,
      ]);
    }
  });

  it("requesting_tenant_id() resolves the tenant of the signed-in user", async () => {
    const { data, error } = await asA.rpc("requesting_tenant_id");
    expect(error).toBeNull();
    expect(data).toBe(tenantA.tenantId);
  });

  it("supabase_auth_admin can resolve it (USAGE on schema public)", async () => {
    const { rows } = await db.query<{ usage: boolean }>(
      "SELECT has_schema_privilege('supabase_auth_admin', 'public', 'USAGE') AS usage",
    );
    expect(rows[0].usage).toBe(true);
  });

  it("is executable only by supabase_auth_admin", async () => {
    const { rows } = await db.query<{ grantee: string; can_execute: boolean }>(`
      SELECT r.rolname AS grantee,
             has_function_privilege(r.rolname, 'public.custom_access_token_hook(jsonb)', 'EXECUTE') AS can_execute
      FROM pg_roles r
      WHERE r.rolname IN ('anon', 'authenticated', 'supabase_auth_admin')
      ORDER BY r.rolname`);
    expect(rows).toEqual([
      { grantee: "anon", can_execute: false },
      { grantee: "authenticated", can_execute: false },
      { grantee: "supabase_auth_admin", can_execute: true },
    ]);

    const { rows: publicGrant } = await db.query<{ granted: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc p,
             aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        WHERE p.oid = 'public.custom_access_token_hook(jsonb)'::regprocedure
          AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
      ) AS granted`);
    expect(publicGrant[0].granted, "PUBLIC can execute the hook").toBe(false);
  });
});

describe("no hard delete for authenticated", () => {
  it("every permissive DELETE policy is neutralised by a restrictive block", async () => {
    const { rows } = await db.query<{ tablename: string; policyname: string }>(`
      SELECT p.tablename::text, p.policyname::text
      FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.permissive = 'PERMISSIVE'
        AND p.cmd IN ('DELETE', 'ALL')
        AND p.roles && ARRAY['authenticated', 'public']::name[]
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies r
          WHERE r.schemaname = 'public' AND r.tablename = p.tablename
            AND r.permissive = 'RESTRICTIVE' AND r.cmd IN ('DELETE', 'ALL')
            AND r.roles && ARRAY['authenticated', 'public']::name[]
            AND r.qual = 'false'
        )
      ORDER BY 1, 2`);
    expect(rows).toEqual([]);
  });
});

describe("row level security is enabled and forced", () => {
  it("on every table in public", async () => {
    const { rows } = await db.query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
      ORDER BY 1`);
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });
});

describe.each(TABLES)("tenant isolation on public.%s", (table) => {
  it("tenant A cannot read rows of other tenants", async () => {
    const result = await asA.from(table).select("tenant_id").neq("tenant_id", tenantA.tenantId);
    expectDeniedOrEmpty(result, `A read foreign rows of ${table}`);
  });

  it("tenant A cannot insert rows into tenant B", async () => {
    const candidate: Row = buildRow(await meta(table), {
      tenantId: tenantB.tenantId,
      authUserId: noTenantUserId,
      fixtures: tenantB.fixtures,
    });
    const before = await countTenantRows(table, tenantB.tenantId);
    const { error } = await asA.from(table).insert(candidate);
    expect(await countTenantRows(table, tenantB.tenantId), `A wrote a row into tenant B's ${table}`).toBe(before);
    // Without triggers, any other error comes from checks that run after RLS WITH CHECK passed.
    expectDeniedOrNoop(error, `A insert into tenant B's ${table} reached past RLS`);
  });

  it("tenant A cannot update rows of tenant B", async () => {
    const keep = await asA.from(table).update({ tenant_id: tenantB.tenantId }).eq("tenant_id", tenantB.tenantId);
    expectDeniedOrNoop(keep.error, `A update of tenant B's ${table}`);
    const steal = await asA.from(table).update({ tenant_id: tenantA.tenantId }).eq("tenant_id", tenantB.tenantId);
    expectDeniedOrNoop(steal.error, `A moving tenant B's ${table} rows`);
    expect(await fixtureIntact(table, tenantB), `tenant B's ${table} row was modified by A`).toBe(true);
  });

  it("a user without a tenant claim sees no rows", async () => {
    const result = await asNoTenant.from(table).select("tenant_id").limit(5);
    expectDeniedOrEmpty(result, `user without tenant read ${table}`);
  });

  it("anon sees no rows", async () => {
    const result = await anon.from(table).select("tenant_id").limit(5);
    expectDeniedOrEmpty(result, `anon read ${table}`);
  });

  it("service_role reads rows of every tenant", async () => {
    const { data, error } = await svc
      .from(table)
      .select("tenant_id")
      .in("tenant_id", [tenantA.tenantId, tenantB.tenantId]);
    expect(error).toBeNull();
    expect(new Set((data ?? []).map((r) => r.tenant_id))).toEqual(
      new Set([tenantA.tenantId, tenantB.tenantId]),
    );
  });
});

// Last, because a failing policy here would delete the fixtures other tests rely on.
describe.each(TABLES)("no hard delete on public.%s", (table) => {
  it("authenticated cannot delete rows of its own tenant", async () => {
    // A cascade from an earlier table must not silently strip A's admin rights.
    const admin = await asA.rpc("is_tenant_admin");
    expect(admin.data, "attacker A is no longer a tenant admin").toBe(true);
    const { error } = await asA.from(table).delete().eq("tenant_id", tenantA.tenantId);
    expectDeniedOrNoop(error, `A delete on ${table}`);
    expect(await fixtureIntact(table, tenantA), `A deleted its own ${table} row`).toBe(true);
  });
});
