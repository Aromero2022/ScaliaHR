import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

/**
 * D25 — app roles hold no privilege that bypasses RLS or acts like DDL, the
 * audit log is insert-only for them, and the Supabase advisors report nothing.
 */

const env = integrationEnv();
const REPO = path.resolve(__dirname, "../../../..");
const RISKY = ["TRUNCATE", "TRIGGER", "REFERENCES", "MAINTAIN"];
const APP_ROLES = ["anon", "authenticated", "prisma_app", "worker_app", "email_enqueuer", "authenticator"];

const db = new pg.Client({ connectionString: env.dbUrl });
const app = new pg.Client({ connectionString: env.prismaDbUrl });
await db.connect();
await app.connect();
const world = new TestWorld(env, db);
let tenant: TestTenant;

beforeAll(async () => {
  tenant = await world.createTenant();
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await app.end();
    await db.end();
  }
});

describe("table privileges of the app roles (D25)", () => {
  it("none holds TRUNCATE, TRIGGER, REFERENCES or MAINTAIN on any table of public, pgboss or ops", async () => {
    const { rows } = await db.query<{ role: string; table: string; privilege: string }>(
      `SELECT r.rolname AS role, format('%I.%I', n.nspname, c.relname) AS table, p AS privilege
       FROM pg_roles r
       CROSS JOIN pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN unnest($2::text[]) p
       WHERE r.rolname = ANY($1::text[])
         AND n.nspname IN ('public', 'pgboss', 'ops')
         AND c.relkind IN ('r', 'p', 'v', 'm')
         AND has_table_privilege(r.oid, c.oid, p)
       ORDER BY 1, 2, 3`,
      [APP_ROLES, RISKY],
    );
    expect(rows).toEqual([]);
  });

  it("a table added by a later migration starts without them", async () => {
    await db.query("BEGIN");
    try {
      await db.query("CREATE TABLE public.d25_probe (id int)");
      const { rows } = await db.query<{ role: string; select: boolean; risky: boolean }>(
        `SELECT r AS role,
                has_table_privilege(r, 'public.d25_probe', 'SELECT') AS select,
                has_table_privilege(r, 'public.d25_probe', 'TRUNCATE')
                  OR has_table_privilege(r, 'public.d25_probe', 'TRIGGER')
                  OR has_table_privilege(r, 'public.d25_probe', 'REFERENCES')
                  OR has_table_privilege(r, 'public.d25_probe', 'MAINTAIN') AS risky
         FROM unnest(ARRAY['anon', 'authenticated']) r ORDER BY 1`,
      );
      // Supabase's default grants still apply (RLS guards rows); the risky ones are gone.
      expect(rows).toEqual([
        { role: "anon", select: true, risky: false },
        { role: "authenticated", select: true, risky: false },
      ]);
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("refuses TRUNCATE from an app connection, as itself or as authenticated", async () => {
    await expect(app.query("TRUNCATE public.users")).rejects.toMatchObject({ code: "42501" });
    await app.query("BEGIN");
    try {
      await app.query("SET LOCAL ROLE authenticated");
      await expect(app.query("TRUNCATE public.audit_logs")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await app.query("ROLLBACK");
    }
  });
});

describe("audit log is insert-only for the app (D25)", () => {
  async function auditCount() {
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1 AND action = 'AUTH_LOGIN'",
      [tenant.id],
    );
    return rows[0].n;
  }

  it("the tenant owner can neither change nor delete entries", async () => {
    const before = await auditCount();
    expect(before).toBeGreaterThan(0);
    await tenant.admin.client.from("audit_logs").update({ action: "D25_TAMPERED" }).eq("tenant_id", tenant.id);
    await tenant.admin.client.from("audit_logs").delete().eq("tenant_id", tenant.id);
    expect(await auditCount()).toBe(before);
    const { rows } = await db.query("SELECT 1 FROM public.audit_logs WHERE action = 'D25_TAMPERED'");
    expect(rows).toEqual([]);
  });

  it("an app connection acting for the tenant cannot change, delete or truncate entries", async () => {
    const before = await auditCount();
    await app.query("BEGIN");
    try {
      await app.query("SET LOCAL ROLE authenticated");
      await app.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ tenant_id: tenant.id, app_role: "owner", sub: tenant.admin.authId }),
      ]);
      const updated = await app.query("UPDATE public.audit_logs SET action = 'D25_TAMPERED' WHERE tenant_id = $1", [tenant.id]);
      const deleted = await app.query("DELETE FROM public.audit_logs WHERE tenant_id = $1", [tenant.id]);
      expect(updated.rowCount).toBe(0);
      expect(deleted.rowCount).toBe(0);
      await expect(app.query("TRUNCATE public.audit_logs")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await app.query("ROLLBACK");
    }
    expect(await auditCount()).toBe(before);
  });
});

describe("rate_limits (D25, D28)", () => {
  it("is not reachable from the Data API, directly or through the limiter", async () => {
    const direct = await tenant.employee.client.from("rate_limits").select("id");
    expect(direct.error?.code).toBe("42501");
    // D28: only the server (prisma_app) spends tokens; see rate-limiting.test.ts.
    const viaRpc = await tenant.employee.client.rpc("rate_limit_consume", {
      p_key: `d25-${tenant.id}`,
      p_action: "d25_probe",
      p_max_tokens: 5,
      p_window_seconds: 60,
    });
    expect(viaRpc.error?.code).toBe("42501");
  });
});

describe("Supabase advisors (D25)", () => {
  it("report no security or performance finding on the local database", () => {
    const run = spawnSync("node", ["scripts/check-advisors.mjs"], { cwd: REPO, encoding: "utf-8" });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
  }, 120_000);
});
