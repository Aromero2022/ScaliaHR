import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import pg from "pg";
import type { PgBoss } from "pg-boss";
import { createBoss } from "../../src/boss.js";
import type { TenantExport } from "../../src/backup.js";
import { QUEUES } from "../../src/queues.js";
import { startWorker } from "../../src/worker.js";

/**
 * D23 — backups against the local Supabase stack, in CI on every PR:
 * the worker exports one tenant, the export restores that tenant without
 * touching any other, and a full backup restores the whole database in place.
 */

function localUrl(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing: source scripts/supabase-test-env.sh first.`);
  if (!["127.0.0.1", "localhost"].includes(new URL(value).hostname)) {
    throw new Error(`${name} must point to the local Supabase stack`);
  }
  return value;
}

const workerUrl = localUrl("WORKER_TEST_DB_URL");
const adminUrl = localUrl("SUPABASE_TEST_DB_URL");
const REPO = path.resolve(__dirname, "../../../..");
const scratch = mkdtempSync(path.join(tmpdir(), "backup-test-"));
const admin = new pg.Client({ connectionString: adminUrl });
const worker = new pg.Client({ connectionString: workerUrl });
let boss: PgBoss;
let sender: PgBoss;

interface Fixture {
  tenantId: string;
  authId: string;
  userIds: string[];
}
const a: Fixture = { tenantId: randomUUID(), authId: randomUUID(), userIds: [randomUUID(), randomUUID()] };
const b: Fixture = { tenantId: randomUUID(), authId: randomUUID(), userIds: [randomUUID(), randomUUID()] };

async function createFixture(f: Fixture) {
  const slug = `it-${f.tenantId.slice(0, 8)}`;
  await admin.query("INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $3)", [f.tenantId, `Backup ${slug}`, slug]);
  await admin.query(
    `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                             created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(),
             now(), now(), '{}'::jsonb, '{}'::jsonb)`,
    [f.authId, `${slug}@example.test`],
  );
  for (const [i, id] of f.userIds.entries()) {
    await admin.query(
      `INSERT INTO public.users (id, tenant_id, auth_uid, email, first_name, last_name, status)
       VALUES ($1, $2, $3, $4, $5, 'Backup', 'ACTIVE')`,
      [id, f.tenantId, i === 0 ? f.authId : null, `u${i}-${slug}@example.test`, `User ${i}`],
    );
  }
  await admin.query(
    "INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role, is_active) VALUES ($1, $2, 'owner', true)",
    [f.authId, f.tenantId],
  );
  await admin.query(
    `INSERT INTO public.system_configurations (tenant_id, key, value_json)
     VALUES ($1, 'company.branding', '{"primaryColor":"#0F766E","precise":12345678901234567890.123}')`,
    [f.tenantId],
  );
  const pool = await admin.query("INSERT INTO public.talent_pools (tenant_id, name) VALUES ($1, 'Pool') RETURNING id", [
    f.tenantId,
  ]);
  await admin.query("INSERT INTO public.talent_pool_entries (talent_pool_id, user_id) VALUES ($1, $2), ($1, $3)", [
    pool.rows[0].id,
    ...f.userIds,
  ]);
  const plan = await admin.query(
    "INSERT INTO public.succession_plans (tenant_id, position_title) VALUES ($1, 'CEO') RETURNING id",
    [f.tenantId],
  );
  await admin.query("INSERT INTO public.succession_nominees (succession_plan_id, user_id) VALUES ($1, $2)", [
    plan.rows[0].id,
    f.userIds[1],
  ]);
  await admin.query(
    "INSERT INTO public.audit_logs (tenant_id, user_id, action, entity) VALUES ($1, $2, 'FIXTURE', 'test')",
    [f.tenantId, f.userIds[0]],
  );
}

/** Every row of every table an export covers, scoped to one tenant, sorted. */
async function tenantSnapshot(tenantId: string): Promise<Record<string, string[]>> {
  const { rows: tables } = await admin.query<{ table_name: string }>("SELECT table_name FROM public.tenant_backup_tables()");
  const snapshot: Record<string, string[]> = {};
  for (const { table_name } of tables) {
    const { rows } = await admin.query<{ r: string }>("SELECT r FROM public.tenant_export_rows($1, $2) AS r", [
      tenantId,
      table_name,
    ]);
    snapshot[table_name] = rows.map((r) => r.r).sort();
  }
  return snapshot;
}

/** Row count and content hash of every application table, plus accounts and history. */
async function databaseSnapshot(): Promise<Record<string, string>> {
  const { rows: tables } = await admin.query<{ name: string }>(
    `SELECT format('%I.%I', n.nspname, c.relname) AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'pgboss', 'ops') AND c.relkind = 'r'
     UNION ALL SELECT unnest(ARRAY['auth.users', 'auth.identities', 'auth.mfa_factors', 'supabase_migrations.schema_migrations'])
     ORDER BY 1`,
  );
  const snapshot: Record<string, string> = {};
  for (const { name } of tables) {
    const { rows } = await admin.query(
      `SELECT count(*) || ':' || md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS s FROM ${name} x`,
    );
    snapshot[name] = rows[0].s;
  }
  return snapshot;
}

/** The same, without pgboss: a running worker keeps updating its own bookkeeping. */
async function dataSnapshot(): Promise<Record<string, string>> {
  return Object.fromEntries(Object.entries(await databaseSnapshot()).filter(([name]) => !name.startsWith("pgboss.")));
}

async function requestExport(
  tenantId: string,
  until = ["completed", "failed"],
): Promise<{ state: string; output?: TenantExport }> {
  const id = await sender.send(QUEUES.tenantExport, { tenantId });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const job = await sender.getJobById(QUEUES.tenantExport, id!);
    if (job && until.includes(job.state)) return { state: job.state, output: job.output as TenantExport };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`export job ${id} did not finish`);
}

function restoreTenant(tenantId: string, file: string, dbUrl = adminUrl) {
  const result = spawnSync("node", ["scripts/restore-tenant.mjs", "--tenant", tenantId, "--file", file, "--db-url", dbUrl], {
    cwd: REPO,
    encoding: "utf-8",
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function script(name: string, ...args: string[]) {
  const result = spawnSync("bash", [`scripts/${name}`, ...args], { cwd: REPO, encoding: "utf-8" });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

beforeAll(async () => {
  await admin.connect();
  await worker.connect();
  await createFixture(a);
  await createFixture(b);
  boss = await startWorker({
    databaseUrl: workerUrl,
    email: { smtp: { host: "127.0.0.1", port: 1 }, from: "no-reply@scaliahr.localhost", appBaseUrl: "http://localhost:3000" },
    backupDir: scratch,
  });
  sender = createBoss(workerUrl, { supervise: false });
  await sender.start();
});

afterAll(async () => {
  await sender?.stop({ graceful: false });
  await boss?.stop({ graceful: true, timeout: 5_000 });
  for (const f of [a, b]) {
    await admin.query("BEGIN");
    await admin.query("SET LOCAL session_replication_role = replica");
    for (const t of ["talent_pool_entries", "succession_nominees"]) {
      await admin.query(`DELETE FROM public.${t} WHERE user_id = ANY($1::uuid[])`, [f.userIds]);
    }
    const { rows } = await admin.query<{ table_name: string }>(
      "SELECT table_name FROM public.tenant_backup_tables() WHERE parent_table IS NULL AND table_name <> 'tenants'",
    );
    for (const { table_name } of rows) {
      await admin.query(`DELETE FROM public.${table_name} WHERE tenant_id = $1`, [f.tenantId]);
    }
    await admin.query("DELETE FROM public.tenants WHERE id = $1", [f.tenantId]);
    await admin.query("COMMIT");
    await admin.query("DELETE FROM auth.users WHERE id = $1", [f.authId]);
  }
  await admin.end();
  await worker.end();
  rmSync(scratch, { recursive: true, force: true });
});

describe("what a tenant export covers (D23)", () => {
  it("classifies every public table: exported, or left out on purpose", async () => {
    const { rows: all } = await admin.query<{ relname: string }>(
      "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') AND NOT relispartition",
    );
    const { rows: covered } = await admin.query<{ table_name: string }>("SELECT table_name FROM public.tenant_backup_tables()");
    const notExported = ["rate_limits", "user_settings"];
    const unclassified = all
      .map((r) => r.relname)
      .filter((t) => !covered.some((c) => c.table_name === t) && !notExported.includes(t));
    expect(unclassified, "new table: give it tenant_id, add it as a child in tenant_backup_tables() or justify leaving it out").toEqual([]);
  });

  it("is readable by worker_app only through the export functions", async () => {
    const { rows } = await admin.query<{ role: string; fn: string }>(
      `SELECT r.rolname AS role, f AS fn FROM pg_roles r,
         unnest(ARRAY['public.tenant_backup_tables()', 'public.tenant_export_rows(uuid,text)', 'public.backup_schema_version()']) f
       WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'prisma_app', 'email_enqueuer', 'worker_app')
         AND has_function_privilege(r.oid, f, 'EXECUTE')`,
    );
    expect([...new Set(rows.map((r) => r.role))]).toEqual(["worker_app"]);
    await expect(worker.query("SELECT id FROM public.users LIMIT 1")).rejects.toMatchObject({ code: "42501" });
  });

  it("refuses tables outside the export instead of reading them", async () => {
    await expect(
      worker.query("SELECT * FROM public.tenant_export_rows($1, 'user_settings')", [a.tenantId]),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      worker.query(`SELECT * FROM public.tenant_export_rows($1, 'users; DROP TABLE public.users')`, [a.tenantId]),
    ).rejects.toMatchObject({ code: "22023" });
  });
});

describe("per-tenant export by the worker and restore (D23)", () => {
  let file: string;
  let original: Record<string, string[]>;

  it("writes one file with only that tenant's rows", async () => {
    original = await tenantSnapshot(a.tenantId);
    const job = await requestExport(a.tenantId);
    expect(job.state).toBe("completed");
    file = job.output!.path;
    expect(path.dirname(file)).toBe(path.join(scratch, "tenants", a.tenantId));

    const text = gunzipSync(readFileSync(file)).toString("utf-8");
    expect(text).toContain(a.tenantId);
    expect(text).not.toContain(b.tenantId);
    for (const id of b.userIds) expect(text).not.toContain(id);
    expect(text).toContain("12345678901234567890.123");
    const counts = Object.fromEntries(Object.entries(original).map(([t, rows]) => [t, rows.length]));
    expect(job.output!.counts).toEqual(counts);
    expect(counts).toMatchObject({ tenants: 1, users: 2, talent_pool_entries: 2, succession_nominees: 1, audit_logs: 1 });
  });

  it("fails the job for a tenant that does not exist, writing nothing", async () => {
    const missing = randomUUID();
    // The first attempt fails; retries (then the dead letter queue) follow the queue's policy.
    const job = await requestExport(missing, ["retry", "failed"]);
    expect(job.state).toBe("retry");
    expect(JSON.stringify(job.output)).toContain(`tenant ${missing} does not exist`);
    expect(readdirSync(path.join(scratch))).not.toContain(missing);
    expect(readdirSync(path.join(scratch, "tenants"))).not.toContain(missing);
  });

  it("refuses a file for another tenant, a corrupted file or a remote database, changing nothing", async () => {
    const before = await dataSnapshot();

    const wrongTenant = restoreTenant(b.tenantId, file);
    expect(wrongTenant.status).not.toBe(0);
    expect(wrongTenant.output).toContain(`belongs to tenant ${a.tenantId}`);

    const tampered = path.join(scratch, "tampered.export.gz");
    const text = gunzipSync(readFileSync(file)).toString("utf-8").replace("#0F766E", "#000000");
    writeFileSync(tampered, gzipSync(text));
    const corrupted = restoreTenant(a.tenantId, tampered);
    expect(corrupted.status).not.toBe(0);
    expect(corrupted.output).toContain("SHA-256 does not match");

    const remote = restoreTenant(a.tenantId, file, "postgresql://postgres:pw@db.example.invalid:5432/postgres");
    expect(remote.status).not.toBe(0);
    expect(remote.output).toContain("non-local database");

    expect(await dataSnapshot()).toEqual(before);
  });

  it("brings the tenant back to the export without touching any other tenant", async () => {
    const otherTenantBefore = await tenantSnapshot(b.tenantId);
    const seedTenantBefore = await tenantSnapshot("a0000000-0000-0000-0000-000000000001");

    // After the export: a user is deleted (cascading to its pool entry and
    // audit entry), a setting changes, a new user acts, an old one acts again.
    await admin.query("DELETE FROM public.users WHERE id = $1", [a.userIds[0]]);
    await admin.query("UPDATE public.system_configurations SET value_json = '{}' WHERE tenant_id = $1", [a.tenantId]);
    const newcomer = randomUUID();
    await admin.query(
      `INSERT INTO public.users (id, tenant_id, email, first_name, last_name, status)
       VALUES ($1, $2, $3, 'New', 'User', 'ACTIVE')`,
      [newcomer, a.tenantId, `new-${newcomer}@example.test`],
    );
    await admin.query(
      "INSERT INTO public.audit_logs (tenant_id, user_id, action) VALUES ($1, $2, 'AFTER_EXPORT'), ($1, $3, 'NEWCOMER')",
      [a.tenantId, a.userIds[1], newcomer],
    );

    const result = restoreTenant(a.tenantId, file);
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("1 kept, 1 moved to");

    const restored = await tenantSnapshot(a.tenantId);
    const { audit_logs: audit, ...rest } = restored;
    const { audit_logs: originalAudit, ...originalRest } = original;
    expect(rest).toEqual(originalRest);
    expect(audit).toHaveLength(originalAudit.length + 1);
    expect(audit.filter((r) => originalAudit.includes(r))).toHaveLength(originalAudit.length);
    expect(audit.some((r) => r.includes("AFTER_EXPORT"))).toBe(true);
    expect(audit.some((r) => r.includes("NEWCOMER"))).toBe(false);

    const report = readdirSync(path.dirname(file)).find((f) => f.includes(".restore-"));
    const dropped = JSON.parse(readFileSync(path.join(path.dirname(file), report!), "utf-8")).droppedAuditEntries;
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toContain("NEWCOMER");

    expect(await tenantSnapshot(b.tenantId)).toEqual(otherTenantBefore);
    expect(await tenantSnapshot("a0000000-0000-0000-0000-000000000001")).toEqual(seedTenantBefore);
  });

  it("refuses to restore over a schema version the export was not taken on", async () => {
    const before = await dataSnapshot();
    const stale = path.join(scratch, "stale.export.gz");
    const text = gunzipSync(readFileSync(file)).toString("utf-8").replace(/"schemaVersion":"\d+"/, '"schemaVersion":"20000101000000"');
    writeFileSync(stale, gzipSync(text));
    const result = restoreTenant(a.tenantId, stale);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("restore it on the same schema version");
    expect(await dataSnapshot()).toEqual(before);
  });
});

describe("full backup and in-place restore (D23)", () => {
  it("brings the whole database back, accounts and migration history included", async () => {
    await boss.stop({ graceful: true, timeout: 5_000 });
    await sender.stop({ graceful: false });
    const before = await databaseSnapshot();

    const backup = script("backup-full.sh", scratch);
    expect(backup.status, backup.output).toBe(0);
    const dir = path.join(scratch, readdirSync(scratch).find((d) => d.startsWith("full-"))!);

    // Disaster: every tenant gone, an account gone, history rewritten, a stray table.
    await admin.query("DELETE FROM public.tenants");
    await admin.query("DELETE FROM auth.users WHERE id = $1", [b.authId]);
    await admin.query("DELETE FROM supabase_migrations.schema_migrations WHERE version > '20261101000000'");
    await admin.query("CREATE TABLE public.d23_stray (id int)");
    expect(await databaseSnapshot()).not.toEqual(before);

    const restore = script("restore-full.sh", dir);
    expect(restore.status, restore.output).toBe(0);
    expect(await databaseSnapshot()).toEqual(before);
    const { rows } = await admin.query("SELECT to_regclass('public.d23_stray') IS NULL AS gone");
    expect(rows[0].gone).toBe(true);
  }, 300_000);

  it("refuses a backup whose dump does not match its checksum, changing nothing", async () => {
    const dir = path.join(scratch, readdirSync(scratch).find((d) => d.startsWith("full-"))!);
    const before = await databaseSnapshot();
    writeFileSync(path.join(dir, "platform.dump"), "corrupted");
    const restore = script("restore-full.sh", dir);
    expect(restore.status).not.toBe(0);
    expect(restore.output).toContain("SHA-256 mismatch");
    expect(await databaseSnapshot()).toEqual(before);
  }, 120_000);
});
