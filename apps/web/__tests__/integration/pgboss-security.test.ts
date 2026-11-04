import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { integrationEnv } from "./helpers/env";

/**
 * D17 — the pgboss schema belongs to migrations and to worker_app only.
 * worker_app connects with its own password so these checks hit the real
 * privileges, not the superuser's.
 */

const env = integrationEnv();
const workerUrl = process.env.WORKER_TEST_DB_URL;
if (!workerUrl) {
  throw new Error(
    "WORKER_TEST_DB_URL is missing: run scripts/run-integration-tests.sh, which sets the worker_app test password.",
  );
}
if (!["127.0.0.1", "localhost"].includes(new URL(workerUrl).hostname)) {
  throw new Error("WORKER_TEST_DB_URL must point to the local Supabase stack");
}

const admin = new pg.Client({ connectionString: env.dbUrl });
const worker = new pg.Client({ connectionString: workerUrl });
await admin.connect();
await worker.connect();
afterAll(async () => {
  await admin.end();
  await worker.end();
});

const workerDir = path.resolve(__dirname, "../../../worker");
const pgBoss = createRequire(path.join(workerDir, "package.json"))("pg-boss/package.json") as {
  version: string;
  pgboss: { schema: number };
};

describe("pgboss schema version (D17)", () => {
  it("matches the schema version of the installed pg-boss package", async () => {
    const { rows } = await worker.query<{ version: string }>("SELECT version FROM pgboss.version");
    expect(rows).toHaveLength(1);
    const dbVersion = Number(rows[0].version);
    expect(
      dbVersion,
      `pgboss schema is v${dbVersion} but pg-boss ${pgBoss.version} expects v${pgBoss.pgboss.schema}. ` +
        `Add a migration with: npm -w @scaliahr/worker run pgboss:sql -- migrate ${dbVersion}`,
    ).toBe(pgBoss.pgboss.schema);
  });

  it("pins pg-boss to the exact installed version", () => {
    const pkg = JSON.parse(readFileSync(path.join(workerDir, "package.json"), "utf-8"));
    expect(pkg.dependencies["pg-boss"]).toBe(pgBoss.version);
  });
});

describe("pgboss queues (D17)", () => {
  it("keeps every queue in the shared job table (no per-queue DDL)", async () => {
    const { rows } = await worker.query<{ name: string; partition: boolean }>(
      "SELECT name, partition FROM pgboss.queue ORDER BY name",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.partition).map((r) => r.name)).toEqual([]);
  });

  it("has no date-named queue_stats partitions", async () => {
    const { rows } = await admin.query(
      "SELECT inhrelid::regclass::text AS part FROM pg_inherits WHERE inhparent = 'pgboss.queue_stats'::regclass",
    );
    expect(rows).toEqual([]);
  });
});

describe("worker_app privileges (D17)", () => {
  it("is a plain login role", async () => {
    const { rows } = await admin.query(
      `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
       FROM pg_roles WHERE rolname = 'worker_app'`,
    );
    expect(rows).toEqual([
      { rolcanlogin: true, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false },
    ]);
  });

  it("has no CREATE privilege on schema pgboss, schema public or the database", async () => {
    const { rows } = await admin.query(
      `SELECT has_schema_privilege('worker_app', 'pgboss', 'CREATE') AS pgboss,
              has_schema_privilege('worker_app', 'public', 'CREATE') AS public,
              has_database_privilege('worker_app', current_database(), 'CREATE') AS database`,
    );
    expect(rows[0]).toEqual({ pgboss: false, public: false, database: false });
  });

  it("cannot create tables in pgboss or public", async () => {
    await expect(worker.query("CREATE TABLE pgboss.d17_probe (id int)")).rejects.toMatchObject({ code: "42501" });
    await expect(worker.query("CREATE TABLE public.d17_probe (id int)")).rejects.toMatchObject({ code: "42501" });
  });

  it("owns no database object", async () => {
    const { rows } = await admin.query(
      `SELECT (SELECT count(*) FROM pg_class WHERE relowner = 'worker_app'::regrole)::int
            + (SELECT count(*) FROM pg_proc WHERE proowner = 'worker_app'::regrole)::int
            + (SELECT count(*) FROM pg_namespace WHERE nspowner = 'worker_app'::regrole)::int
            + (SELECT count(*) FROM pg_type WHERE typowner = 'worker_app'::regrole)::int AS owned`,
    );
    expect(rows[0].owned).toBe(0);
  });

  it("cannot declare or delete queues", async () => {
    await expect(
      worker.query(
        "INSERT INTO pgboss.queue (name, policy, table_name) VALUES ('d17.probe', 'standard', 'job_common')",
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      worker.query(`SELECT pgboss.create_queue('d17.probe', '{"policy":"standard"}'::jsonb)`),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(worker.query("SELECT pgboss.delete_queue('system.ping')")).rejects.toMatchObject({ code: "42501" });
    await expect(worker.query("DELETE FROM pgboss.queue")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("pgboss isolation (D17)", () => {
  it("only worker_app and the migration owner can use the schema", async () => {
    const { rows } = await admin.query<{ role: string; usage: boolean }>(
      `SELECT r.rolname AS role, has_schema_privilege(r.oid, 'pgboss', 'USAGE') AS usage
       FROM pg_roles r
       WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'prisma_app', 'authenticator')
       ORDER BY 1`,
    );
    expect(rows.filter((r) => r.usage).map((r) => r.role)).toEqual([]);
  });

  it("grants table and function privileges to nobody else", async () => {
    const { rows } = await admin.query<{ object: string; grantee: string }>(
      `SELECT c.relname AS object, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee
       FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.relnamespace = 'pgboss'::regnamespace AND c.relkind IN ('r', 'p')
         AND a.grantee NOT IN ('worker_app'::regrole, c.relowner)
       UNION
       SELECT p.oid::regprocedure::text, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
       FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       WHERE p.pronamespace = 'pgboss'::regnamespace
         AND a.grantee NOT IN ('worker_app'::regrole, p.proowner)
       ORDER BY 1, 2`,
    );
    expect(rows).toEqual([]);
  });

  it("enables and forces RLS on every table, partitions included", async () => {
    const { rows } = await admin.query<{ relname: string }>(
      `SELECT relname FROM pg_class
       WHERE relnamespace = 'pgboss'::regnamespace AND relkind IN ('r', 'p')
         AND NOT (relrowsecurity AND relforcerowsecurity)
       ORDER BY 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("has policies only for worker_app and the migration owner", async () => {
    const { rows } = await admin.query<{ role: string }>(
      "SELECT DISTINCT unnest(roles)::text AS role FROM pg_policies WHERE schemaname = 'pgboss' ORDER BY 1",
    );
    expect(rows.map((r) => r.role)).toEqual(["postgres", "worker_app"]);
  });

  it("is not exposed by the Data API", async () => {
    const res = await fetch(`${env.supabaseUrl}/rest/v1/queue?select=name`, {
      headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Accept-Profile": "pgboss" },
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(406);
  });
});
