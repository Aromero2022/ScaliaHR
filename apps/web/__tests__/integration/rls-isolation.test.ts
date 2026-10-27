import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { randomUUID } from "node:crypto";
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

/**
 * Generic tenant-isolation suite.
 *
 * Every public table with a tenant_id column is discovered from the catalog,
 * so new tables are covered without touching this file. Users are real auth
 * users that sign in with a password; their tenant claim comes from
 * custom_access_token_hook.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const TABLES = await tenantScopedTables(db);

const PASSWORD = `Rls-${randomUUID()}`;
const REAL_ROW_TABLES = new Set(["users", "user_tenant_memberships"]);

interface TenantCtx {
  tenantId: string;
  authUserId: string;
  email: string;
  fixtures: Map<string, StoredFixture>;
}

const svc = createClient(env.supabaseUrl, env.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(env.supabaseUrl, env.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const metas = new Map<string, TableMeta>();
let tenantA: TenantCtx;
let tenantB: TenantCtx;
let noTenantUserId: string;
let noTenantEmail: string;
let tokenA: string;
let tokenB: string;
let tokenNoTenant: string;
let asA: SupabaseClient;
let asNoTenant: SupabaseClient;

function clientFor(token: string): SupabaseClient {
  return createClient(env.supabaseUrl, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

async function createAuthUser(): Promise<{ id: string; email: string }> {
  const email = `rls-${randomUUID()}@example.test`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  return { id: data.user.id, email };
}

async function signIn(email: string): Promise<string> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`signInWithPassword failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}

async function meta(table: string): Promise<TableMeta> {
  if (!metas.has(table)) metas.set(table, await loadTableMeta(db, table));
  return metas.get(table)!;
}

async function setUpTenant(withActiveTenantSetting: boolean): Promise<TenantCtx> {
  const tenantId = randomUUID();
  await insertRow(
    db,
    await meta("tenants"),
    buildRow(await meta("tenants"), {
      tenantId,
      authUserId: "",
      fixtures: new Map(),
      overrides: { id: tenantId },
    }),
    { bypassForeignKeys: false },
  );

  const user = await createAuthUser();
  const ctx: TenantCtx = { tenantId, authUserId: user.id, email: user.email, fixtures: new Map() };

  const usersMeta = await meta("users");
  ctx.fixtures.set(
    "users",
    await insertRow(
      db,
      usersMeta,
      buildRow(usersMeta, { ...ctx, overrides: { auth_uid: user.id, email: user.email } }),
      { bypassForeignKeys: false },
    ),
  );

  const membershipMeta = await meta("user_tenant_memberships");
  ctx.fixtures.set(
    "user_tenant_memberships",
    await insertRow(
      db,
      membershipMeta,
      buildRow(membershipMeta, {
        ...ctx,
        overrides: { user_id: user.id, app_role: "admin", is_active: true },
      }),
      { bypassForeignKeys: false },
    ),
  );

  if (withActiveTenantSetting) {
    await db.query(
      "INSERT INTO public.user_settings (user_id, active_tenant_id) VALUES ($1, $2)",
      [user.id, tenantId],
    );
  }
  return ctx;
}

async function createFixtures(ctx: TenantCtx) {
  const ordered = orderByDependencies(await Promise.all(TABLES.map(meta)));
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

  tenantA = await setUpTenant(true);
  tenantB = await setUpTenant(false);
  const noTenantUser = await createAuthUser();
  noTenantUserId = noTenantUser.id;
  noTenantEmail = noTenantUser.email;

  await createFixtures(tenantA);
  await createFixtures(tenantB);

  tokenA = await signIn(tenantA.email);
  tokenB = await signIn(tenantB.email);
  tokenNoTenant = await signIn(noTenantEmail);

  asA = clientFor(tokenA);
  asNoTenant = clientFor(tokenNoTenant);
});

afterAll(async () => {
  try {
    const tenantIds = [tenantA?.tenantId, tenantB?.tenantId].filter(Boolean);
    if (tenantIds.length > 0) {
      await db.query("BEGIN");
      await db.query("SET LOCAL session_replication_role = replica");
      for (const table of TABLES) {
        await db.query(`DELETE FROM public."${table}" WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
      }
      await db.query("COMMIT");
    }
    for (const id of [tenantA?.authUserId, tenantB?.authUserId, noTenantUserId].filter(Boolean)) {
      await svc.auth.admin.deleteUser(id as string);
    }
    if (tenantIds.length > 0) {
      await db.query("DELETE FROM public.tenants WHERE id = ANY($1::uuid[])", [tenantIds]);
    }
  } finally {
    await db.end();
  }
});

describe("custom_access_token_hook", () => {
  it("injects tenant_id from user_settings.active_tenant_id", () => {
    expect(claimsOf(tokenA).tenant_id).toBe(tenantA.tenantId);
  });

  it("falls back to the first active membership when no active tenant is set", () => {
    expect(claimsOf(tokenB).tenant_id).toBe(tenantB.tenantId);
  });

  it("gives a user without memberships no tenant", () => {
    expect([undefined, null, ""]).toContain(claimsOf(tokenNoTenant).tenant_id);
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
    const { error } = await asA.from(table).delete().eq("tenant_id", tenantA.tenantId);
    expectDeniedOrNoop(error, `A delete on ${table}`);
    expect(await fixtureIntact(table, tenantA), `A deleted its own ${table} row`).toBe(true);
  });
});
