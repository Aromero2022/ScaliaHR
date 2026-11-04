import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { createEmailQueue } from "@/lib/email";
import { integrationEnv } from "./helpers/env";

/**
 * D17 — the pgboss schema belongs to migrations and to worker_app; D20 adds
 * email_enqueuer, which can only enqueue email.send jobs. Both roles connect
 * with their own passwords so these checks hit the real privileges, not the
 * superuser's.
 */

const env = integrationEnv();
const workerUrl = process.env.WORKER_TEST_DB_URL;
if (!workerUrl) {
  throw new Error(
    "WORKER_TEST_DB_URL is missing: run scripts/run-integration-tests.sh, which sets the worker_app test password.",
  );
}
const enqueuerUrl = process.env.EMAIL_ENQUEUER_TEST_DB_URL;
if (!enqueuerUrl) {
  throw new Error(
    "EMAIL_ENQUEUER_TEST_DB_URL is missing: run scripts/run-integration-tests.sh, which sets the email_enqueuer test password.",
  );
}
for (const url of [workerUrl, enqueuerUrl]) {
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
    throw new Error("WORKER_TEST_DB_URL and EMAIL_ENQUEUER_TEST_DB_URL must point to the local Supabase stack");
  }
}

const admin = new pg.Client({ connectionString: env.dbUrl });
const worker = new pg.Client({ connectionString: workerUrl });
const enqueuer = new pg.Client({ connectionString: enqueuerUrl });
const emailQueue = createEmailQueue(enqueuerUrl);
const enqueuedIds: string[] = [];
await admin.connect();
await worker.connect();
await enqueuer.connect();
afterAll(async () => {
  await emailQueue.stop();
  // Nothing consumes these jobs here; do not leave them for the worker suite.
  await admin.query("DELETE FROM pgboss.job WHERE id = ANY($1::uuid[])", [enqueuedIds]);
  await admin.end();
  await worker.end();
  await enqueuer.end();
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

  it("pins pg-boss to the exact installed version in the worker and in the web producer (D20)", () => {
    for (const dir of [workerDir, path.resolve(__dirname, "../..")]) {
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf-8"));
      expect(pkg.dependencies["pg-boss"], `${pkg.name} must pin pg-boss`).toBe(pgBoss.version);
    }
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

  it("grants table and function privileges to nobody else but email_enqueuer's minimum", async () => {
    const { rows } = await admin.query<{ object: string; grantee: string; privilege: string }>(
      `SELECT c.relname AS object, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
              a.privilege_type AS privilege
       FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.relnamespace = 'pgboss'::regnamespace AND c.relkind IN ('r', 'p')
         AND a.grantee NOT IN ('worker_app'::regrole, c.relowner)
       UNION
       SELECT p.oid::regprocedure::text, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,
              a.privilege_type
       FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       WHERE p.pronamespace = 'pgboss'::regnamespace
         AND a.grantee NOT IN ('worker_app'::regrole, p.proowner)
       ORDER BY 1, 2, 3`,
    );
    expect(rows).toEqual([
      { object: "job_common", grantee: "email_enqueuer", privilege: "INSERT" },
      { object: "pgboss.job_now()", grantee: "email_enqueuer", privilege: "EXECUTE" },
      { object: "queue", grantee: "email_enqueuer", privilege: "SELECT" },
      { object: "version", grantee: "email_enqueuer", privilege: "SELECT" },
    ]);
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

  it("has policies only for worker_app, the migration owner and email_enqueuer", async () => {
    const { rows } = await admin.query<{ role: string }>(
      "SELECT DISTINCT unnest(roles)::text AS role FROM pg_policies WHERE schemaname = 'pgboss' ORDER BY 1",
    );
    expect(rows.map((r) => r.role)).toEqual(["email_enqueuer", "postgres", "worker_app"]);
  });

  it("limits email_enqueuer's policies to reading the queue options and inserting email.send jobs", async () => {
    const { rows } = await admin.query(
      `SELECT tablename, cmd, qual, with_check FROM pg_policies
       WHERE schemaname = 'pgboss' AND 'email_enqueuer' = ANY(roles::text[])
       ORDER BY tablename, cmd`,
    );
    expect(rows).toEqual([
      { tablename: "job_common", cmd: "INSERT", qual: null, with_check: "(name = 'email.send'::text)" },
      { tablename: "job_common", cmd: "SELECT", qual: "(name = 'email.send'::text)", with_check: null },
      { tablename: "queue", cmd: "SELECT", qual: "(name = 'email.send'::text)", with_check: null },
      { tablename: "version", cmd: "SELECT", qual: "true", with_check: null },
    ]);
  });

  it("is not exposed by the Data API", async () => {
    const res = await fetch(`${env.supabaseUrl}/rest/v1/queue?select=name`, {
      headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Accept-Profile": "pgboss" },
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(406);
  });
});

describe("email_enqueuer (D20)", () => {
  const job = (overrides: Record<string, unknown> = {}) => ({
    template: "password_reset" as const,
    tenantId: randomUUID(),
    to: "it@example.test",
    data: { resetUrl: "http://localhost:3000/reset/t" },
    ...overrides,
  });

  it("is a plain login role with no CREATE privilege anywhere", async () => {
    const { rows } = await admin.query(
      `SELECT r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole,
              has_schema_privilege(r.oid, 'pgboss', 'CREATE') AS pgboss_create,
              has_schema_privilege(r.oid, 'public', 'CREATE') AS public_create,
              has_database_privilege(r.oid, current_database(), 'CREATE') AS database_create
       FROM pg_roles r WHERE r.rolname = 'email_enqueuer'`,
    );
    expect(rows).toEqual([
      {
        rolcanlogin: true, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false,
        pgboss_create: false, public_create: false, database_create: false,
      },
    ]);
  });

  it("enqueues a valid email.send job through lib/email", async () => {
    const id = await emailQueue.enqueue(job());
    enqueuedIds.push(id);
    const { rows } = await admin.query("SELECT name, state, data->>'template' AS template FROM pgboss.job WHERE id = $1", [id]);
    expect(rows).toEqual([{ name: "email.send", state: "created", template: "password_reset" }]);
  });

  it("rejects an invalid job before it reaches the database", async () => {
    await expect(emailQueue.enqueue(job({ to: "not-an-email" }))).rejects.toThrow();
    await expect(emailQueue.enqueue(job({ template: "welcome" }))).rejects.toThrow();
  });

  it("cannot enqueue on any other queue", async () => {
    await expect(
      enqueuer.query(
        "INSERT INTO pgboss.job_common (name, data) VALUES ('system.ping', '{}') RETURNING id",
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot read job payloads, change or delete jobs", async () => {
    const id = await emailQueue.enqueue(job());
    enqueuedIds.push(id);
    await expect(enqueuer.query("SELECT data FROM pgboss.job_common")).rejects.toMatchObject({ code: "42501" });
    await expect(enqueuer.query("SELECT data FROM pgboss.job")).rejects.toMatchObject({ code: "42501" });
    await expect(
      enqueuer.query("UPDATE pgboss.job_common SET state = 'completed' WHERE id = $1", [id]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(enqueuer.query("DELETE FROM pgboss.job_common WHERE id = $1", [id])).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("sees no other queue and cannot declare one", async () => {
    const { rows } = await enqueuer.query<{ name: string }>("SELECT name FROM pgboss.queue");
    expect(rows.map((r) => r.name)).toEqual(["email.send"]);
    await expect(
      enqueuer.query(`SELECT pgboss.create_queue('d20.probe', '{"policy":"standard"}'::jsonb)`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("has no access to application data or to email_branding", async () => {
    await expect(enqueuer.query("SELECT id FROM public.tenants")).rejects.toMatchObject({ code: "42501" });
    await expect(enqueuer.query("SELECT id FROM public.users")).rejects.toMatchObject({ code: "42501" });
    await expect(enqueuer.query("SELECT * FROM public.email_branding($1)", [randomUUID()])).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("email_branding (D20, D21)", () => {
  const tenantId = randomUUID();
  const suspendedId = randomUUID();

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO public.tenants (id, name, slug, suspended_at)
       VALUES ($1, 'Branding Co', $3, NULL), ($2, 'Suspended Co', $4, now())`,
      [tenantId, suspendedId, `it-${tenantId.slice(0, 8)}`, `it-${suspendedId.slice(0, 8)}`],
    );
    await admin.query(
      `INSERT INTO public.system_configurations (tenant_id, key, value_json) VALUES
         ($1, 'company.branding', '{"logoUrl":"https://cdn.example.test/l.png","primaryColor":"#0F766E","secret":"x"}'),
         ($1, 'platform.locale', '"en"'),
         ($2, 'platform.locale', '"es"')`,
      [tenantId, suspendedId],
    );
  });

  afterAll(async () => {
    await admin.query("DELETE FROM public.system_configurations WHERE tenant_id = ANY($1::uuid[])", [[tenantId, suspendedId]]);
    await admin.query("DELETE FROM public.tenants WHERE id = ANY($1::uuid[])", [[tenantId, suspendedId]]);
  });

  it("gives worker_app the name, logo, color and locale of an active tenant, nothing else", async () => {
    const { rows } = await worker.query("SELECT * FROM public.email_branding($1)", [tenantId]);
    expect(rows).toEqual([
      { tenant_name: "Branding Co", logo_url: "https://cdn.example.test/l.png", primary_color: "#0F766E", locale: "en" },
    ]);
  });

  it("returns no row for a suspended or nonexistent tenant", async () => {
    for (const id of [suspendedId, randomUUID()]) {
      const { rows } = await worker.query("SELECT * FROM public.email_branding($1)", [id]);
      expect(rows).toEqual([]);
    }
  });

  it("is executable only by worker_app among the application roles", async () => {
    const { rows } = await admin.query<{ role: string; can: boolean }>(
      `SELECT r.rolname AS role, has_function_privilege(r.oid, 'public.email_branding(uuid)', 'EXECUTE') AS can
       FROM pg_roles r
       WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'prisma_app', 'authenticator', 'email_enqueuer', 'worker_app')
       ORDER BY 1`,
    );
    expect(rows.filter((r) => r.can).map((r) => r.role)).toEqual(["worker_app"]);
  });

  it("is SECURITY DEFINER with an empty search_path, and worker_app still cannot read tenants", async () => {
    const { rows } = await admin.query(
      `SELECT prosecdef, proconfig FROM pg_proc WHERE oid = 'public.email_branding(uuid)'::regprocedure`,
    );
    expect(rows).toEqual([{ prosecdef: true, proconfig: ['search_path=""'] }]);
    await expect(worker.query("SELECT id FROM public.tenants")).rejects.toMatchObject({ code: "42501" });
  });
});
