import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { integrationEnv } from "./helpers/env";

/**
 * D22 — the sync scripts against the local Supabase stack, never a remote
 * project: integrationEnv() refuses any database that is not on this machine.
 * Production mode applies pending migrations only, and reset is impossible on
 * a database marked as production.
 */

const env = integrationEnv();
const REPO = path.resolve(__dirname, "../../../..");
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const scratch = mkdtempSync(path.join(tmpdir(), "db-sync-modes-"));

afterAll(async () => {
  await db.query("DELETE FROM ops.production_marker");
  await db.end();
  rmSync(scratch, { recursive: true, force: true });
});

function run(script: string, args: string[], workdir?: string) {
  const result = spawnSync("bash", [path.join(REPO, script), ...args], {
    cwd: REPO,
    encoding: "utf-8",
    env: { ...process.env, ...(workdir ? { SUPABASE_WORKDIR: workdir } : {}) },
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

async function state() {
  const { rows } = await db.query<{ history: number; tenants: number; marked: boolean }>(
    `SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations)::int AS history,
            (SELECT count(*) FROM public.tenants)::int AS tenants,
            EXISTS (SELECT 1 FROM ops.production_marker) AS marked`,
  );
  return rows[0];
}

/** A copy of supabase/ with one extra migration, for supabase --workdir. */
function workdirWith(version: string, sql: string): string {
  const dir = mkdtempSync(path.join(scratch, "workdir-"));
  cpSync(path.join(REPO, "supabase/config.toml"), path.join(dir, "supabase/config.toml"));
  cpSync(path.join(REPO, "supabase/migrations"), path.join(dir, "supabase/migrations"), { recursive: true });
  writeFileSync(path.join(dir, `supabase/migrations/${version}_d22_probe.sql`), sql);
  return dir;
}

describe("production mode: scripts/db-migrate-sync.sh (D22)", () => {
  it("is a no-op on an up-to-date database and writes no marker for other targets", async () => {
    const before = await state();
    const result = run("scripts/db-migrate-sync.sh", [env.dbUrl, "local"]);
    expect(result.status, result.output).toBe(0);
    expect(await state()).toEqual({ ...before, marked: false });
  }, 120_000);

  it("applies only the pending migration and leaves existing data alone", async () => {
    const before = await state();
    const version = "29991231000000";
    const workdir = workdirWith(
      version,
      `CREATE TABLE public.d22_probe (id int PRIMARY KEY);
       ALTER TABLE public.d22_probe ENABLE ROW LEVEL SECURITY;
       ALTER TABLE public.d22_probe FORCE ROW LEVEL SECURITY;`,
    );
    try {
      const result = run("scripts/db-migrate-sync.sh", [env.dbUrl, "local"], workdir);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain(`${version}_d22_probe.sql`);
      expect(await state()).toEqual({ ...before, history: before.history + 1 });
      const { rows } = await db.query("SELECT to_regclass('public.d22_probe') IS NOT NULL AS created");
      expect(rows[0].created).toBe(true);
    } finally {
      await db.query("DROP TABLE IF EXISTS public.d22_probe");
      await db.query("DELETE FROM supabase_migrations.schema_migrations WHERE version = $1", [version]);
    }
  }, 120_000);

  it("refuses a migration older than the last applied one instead of running it out of order", async () => {
    const before = await state();
    const workdir = workdirWith("20200101000000", "CREATE TABLE public.d22_old_probe (id int);");
    const result = run("scripts/db-migrate-sync.sh", [env.dbUrl, "local"], workdir);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("DbPushMissingRemoteError");
    const { rows } = await db.query("SELECT to_regclass('public.d22_old_probe') IS NULL AS absent");
    expect(rows[0].absent).toBe(true);
    expect(await state()).toEqual(before);
  }, 120_000);

  it("stops on a history that differs from supabase/migrations and does not repair it", async () => {
    const before = await state();
    await db.query("INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20000101000000')");
    try {
      const result = run("scripts/db-migrate-sync.sh", [env.dbUrl, "local"]);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("DbPushMissingLocalError");
      expect(await state()).toEqual({ ...before, history: before.history + 1 });
      const { rows } = await db.query(
        "SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations WHERE version = '20000101000000'",
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await db.query("DELETE FROM supabase_migrations.schema_migrations WHERE version = '20000101000000'");
    }
  }, 120_000);
});

describe("reset is blocked for production: scripts/db-reset-sync.sh (D7, D22)", () => {
  it("refuses target production and leaves the database untouched", async () => {
    const before = await state();
    const result = run("scripts/db-reset-sync.sh", [env.dbUrl, "production"]);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("not allowed for target 'production'");
    expect(await state()).toEqual(before);
  });

  it("refuses a database synced as production even when the run says it is local", async () => {
    const synced = run("scripts/db-migrate-sync.sh", [env.dbUrl, "production"]);
    expect(synced.status, synced.output).toBe(0);
    const before = await state();
    expect(before.marked).toBe(true);
    try {
      const result = run("scripts/db-reset-sync.sh", [env.dbUrl, "local"]);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("marked as production");
      expect(result.output).not.toContain("Step 1");
      expect(await state()).toEqual(before);
    } finally {
      await db.query("DELETE FROM ops.production_marker");
    }
  }, 120_000);
});

describe("ops.production_marker (D22)", () => {
  it("is invisible to every application role and has ENABLE + FORCE RLS", async () => {
    const { rows } = await db.query<{ role: string; usage: boolean }>(
      `SELECT r.rolname AS role, has_schema_privilege(r.oid, 'ops', 'USAGE') AS usage
       FROM pg_roles r
       WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'prisma_app', 'worker_app', 'email_enqueuer', 'authenticator')`,
    );
    expect(rows.filter((r) => r.usage).map((r) => r.role)).toEqual([]);
    const rls = await db.query(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'ops.production_marker'::regclass",
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("holds at most one row", async () => {
    try {
      await db.query("INSERT INTO ops.production_marker DEFAULT VALUES");
      await expect(db.query("INSERT INTO ops.production_marker (id) VALUES (false)")).rejects.toMatchObject({
        code: "23514",
      });
      await expect(db.query("INSERT INTO ops.production_marker DEFAULT VALUES")).rejects.toMatchObject({
        code: "23505",
      });
    } finally {
      await db.query("DELETE FROM ops.production_marker");
    }
  });
});
