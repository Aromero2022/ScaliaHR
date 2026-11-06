// Load-test fixture (D36), LOCAL database only: one large tenant and a few
// small ones, each with the demo tenant's RBP structure (roles, groups,
// permissions), employees with job records, goals and feedback, and one auth
// account per employee. Run by scripts/load-test.sh; idempotent (every run
// first deletes the previous load tenants and accounts).
//   node load/seed.mjs <db-url> <supabase-url> <service-role-key> <out.json>
import { writeFileSync } from "node:fs";
import pg from "pg";
import { assertLocalDbUrl } from "../scripts/set-local-role-passwords.mjs";

export const LOAD_EMAIL_DOMAIN = "load.scaliahr.test";
export const LOAD_PASSWORD = "Load-Test-Local-2026";
const TEMPLATE_TENANT = "a0000000-0000-0000-0000-000000000001"; // seed.sql demo tenant
// LOAD_BIG_USERS / LOAD_SMALL_USERS shrink the fixture for CI's short run.
const BIG = Number(process.env.LOAD_BIG_USERS ?? 1000);
const SMALL = Number(process.env.LOAD_SMALL_USERS ?? 50);
export const LOAD_TENANTS = [
  { slug: "load-big", name: "Load Big", tag: "LoadGrande", users: BIG },
  { slug: "load-a", name: "Load A", tag: "LoadAlfa", users: SMALL },
  { slug: "load-b", name: "Load B", tag: "LoadBravo", users: SMALL },
  { slug: "load-c", name: "Load C", tag: "LoadCharlie", users: SMALL },
];

async function cleanup(db) {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL session_replication_role = replica");
    const { rows: tables } = await db.query(`
      SELECT c.relname::text AS name FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND a.attname = 'tenant_id' AND NOT a.attisdropped`);
    const { rows: ids } = await db.query("SELECT id FROM public.tenants WHERE slug LIKE 'load-%'");
    const tenantIds = ids.map((r) => r.id);
    for (const { name } of tables) {
      await db.query(`DELETE FROM public.${pg.escapeIdentifier(name)} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
    }
    await db.query("DELETE FROM public.tenants WHERE id = ANY($1::uuid[])", [tenantIds]);
    await db.query("DELETE FROM public.user_settings WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE $1)", [`%@${LOAD_EMAIL_DOMAIN}`]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  // Outside replica mode, so the cascades to identities, sessions and factors run.
  await db.query("DELETE FROM auth.identities WHERE email LIKE $1", [`%@${LOAD_EMAIL_DOMAIN}`]);
  await db.query("DELETE FROM auth.users WHERE email LIKE $1", [`%@${LOAD_EMAIL_DOMAIN}`]);
}

/** Copies the demo tenant's groups, roles, permissions and grants; returns the new "All Employees" group id. */
async function cloneRbp(db, tenantId) {
  const { rows } = await db.query(
    `WITH g AS (
       INSERT INTO public.permission_groups (tenant_id, name)
       SELECT $2, name FROM public.permission_groups WHERE tenant_id = $1
       RETURNING id, name
     ), r AS (
       INSERT INTO public.permission_roles (tenant_id, name, description, is_admin_role)
       SELECT $2, name, description, is_admin_role FROM public.permission_roles WHERE tenant_id = $1
       RETURNING id, name
     ), p AS (
       INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action)
       SELECT $2, r.id, rp.permission_key, rp.action
       FROM public.role_permissions rp
       JOIN public.permission_roles tr ON tr.id = rp.role_id
       JOIN r ON r.name = tr.name
       WHERE rp.tenant_id = $1
       RETURNING 1
     ), gr AS (
       INSERT INTO public.role_grants (tenant_id, role_id, granted_group_id, target_population)
       SELECT $2, r.id, g.id, rg.target_population
       FROM public.role_grants rg
       JOIN public.permission_roles tr ON tr.id = rg.role_id
       JOIN public.permission_groups tg ON tg.id = rg.granted_group_id
       JOIN r ON r.name = tr.name
       JOIN g ON g.name = tg.name
       WHERE rg.tenant_id = $1
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM p) AS permissions, (SELECT count(*) FROM gr) AS grants,
            (SELECT id FROM g WHERE name = 'All Employees') AS employees_group`,
    [TEMPLATE_TENANT, tenantId],
  );
  if (!rows[0].employees_group || Number(rows[0].permissions) === 0) {
    throw new Error("the demo tenant's RBP template is missing: run supabase db reset (seed.sql) first");
  }
  return rows[0].employees_group;
}

async function createAccounts(supabaseUrl, serviceKey, emails) {
  const ids = new Array(emails.length);
  let next = 0;
  async function worker() {
    while (next < emails.length) {
      const i = next++;
      const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: emails[i], password: LOAD_PASSWORD, email_confirm: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(`creating ${emails[i]} failed: ${res.status}`);
      ids[i] = body.id;
    }
  }
  await Promise.all(Array.from({ length: 20 }, worker));
  return ids;
}

async function seedTenant(db, supabaseUrl, serviceKey, spec) {
  const { rows } = await db.query(
    `INSERT INTO public.tenants (name, slug, is_ec_active, is_pmgm_active, is_tih_active)
     VALUES ($1, $2, true, true, true) RETURNING id`,
    [spec.name, spec.slug],
  );
  const tenantId = rows[0].id;
  const employeesGroup = await cloneRbp(db, tenantId);
  const emails = Array.from({ length: spec.users }, (_, i) => `${spec.slug}-${i + 1}@${LOAD_EMAIL_DOMAIN}`);
  const authIds = await createAccounts(supabaseUrl, serviceKey, emails);

  await db.query(
    `WITH input AS (
       SELECT * FROM unnest($2::uuid[], $3::text[]) WITH ORDINALITY AS t(auth_id, email, n)
     ), u AS (
       INSERT INTO public.users (tenant_id, auth_uid, email, first_name, last_name, employee_id, status)
       SELECT $1, auth_id, email, 'Empleado ' || n, $4, $5 || '-' || lpad(n::text, 5, '0'), 'ACTIVE'
       FROM input
       RETURNING id, auth_uid
     ), m AS (
       INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role)
       SELECT auth_uid, $1, 'employee' FROM u RETURNING 1
     ), s AS (
       INSERT INTO public.user_settings (user_id, active_tenant_id)
       SELECT auth_uid, $1 FROM u RETURNING 1
     )
     INSERT INTO public.group_members (tenant_id, group_id, user_id)
     SELECT $1, $6, id FROM u`,
    [tenantId, authIds, emails, spec.tag, spec.slug.toUpperCase(), employeesGroup],
  );

  // A manager per 25 employees, one job record each, and some goals and feedback.
  await db.query(
    `WITH ranked AS (
       SELECT id, row_number() OVER (ORDER BY employee_id) AS n FROM public.users WHERE tenant_id = $1
     ), managers AS (
       SELECT n, id FROM ranked WHERE (n - 1) % 25 = 0
     )
     INSERT INTO public.ec_job_information (tenant_id, user_id, start_date, job_title, manager_id)
     SELECT $1, r.id, DATE '2026-01-01', CASE WHEN (r.n - 1) % 25 = 0 THEN 'Team Lead' ELSE 'Analyst' END,
            CASE WHEN (r.n - 1) % 25 = 0 THEN NULL ELSE m.id END
     FROM ranked r JOIN managers m ON m.n = ((r.n - 1) / 25) * 25 + 1`,
    [tenantId],
  );
  await db.query(
    `INSERT INTO public.performance_goals (tenant_id, user_id, title, status, progress_percentage, period_start, period_end, weight)
     SELECT $1, u.id, 'Objetivo ' || g, 'ON_TRACK', 40, DATE '2026-01-01', DATE '2026-12-31', 0.5
     FROM public.users u CROSS JOIN generate_series(1, 2) g WHERE u.tenant_id = $1`,
    [tenantId],
  );
  await db.query(
    `WITH ranked AS (SELECT id, row_number() OVER (ORDER BY employee_id) AS n, count(*) OVER () AS total FROM public.users WHERE tenant_id = $1)
     INSERT INTO public.continuous_feedbacks (tenant_id, author_id, subject_id, content, visibility, category)
     SELECT $1, a.id, b.id, 'Buen trabajo en el proyecto', 'PUBLIC', 'RECOGNITION'
     FROM ranked a JOIN ranked b ON b.n = (a.n % a.total) + 1`,
    [tenantId],
  );
  return { tenantId, accounts: emails.map((email) => ({ email, tenant: spec.slug, tag: spec.tag })) };
}

/**
 * Only the local stack: the Supabase API on this machine and a local database
 * URL without query parameters. Also used by the e2e accounts (D44). Returns
 * the database URL to connect to.
 */
export function assertLocalStack(dbUrl, supabaseUrl) {
  if (!["127.0.0.1", "localhost"].includes(new URL(supabaseUrl).hostname)) {
    throw new Error("refusing to seed a non-local Supabase");
  }
  return assertLocalDbUrl(dbUrl);
}

async function main() {
  const [dbUrl, supabaseUrl, serviceKey, out] = process.argv.slice(2);
  if (!out) throw new Error("usage: seed.mjs <db-url> <supabase-url> <service-role-key> <out.json>");
  const db = new pg.Client({ connectionString: assertLocalStack(dbUrl, supabaseUrl) });
  await db.connect();
  try {
    await cleanup(db);
    const accounts = [];
    for (const spec of LOAD_TENANTS) {
      const seeded = await seedTenant(db, supabaseUrl, serviceKey, spec);
      accounts.push(...seeded.accounts);
      console.log(`seeded ${spec.slug}: ${spec.users} employees`);
    }
    await db.query("ANALYZE");
    writeFileSync(out, JSON.stringify({ password: LOAD_PASSWORD, accounts }));
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
