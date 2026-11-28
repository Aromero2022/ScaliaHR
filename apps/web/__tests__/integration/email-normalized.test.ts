import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { integrationEnv } from "./helpers/env";
import { TestWorld } from "./helpers/world";

/**
 * D57: public.users.email is stored as lower(btrim(email)), checked by
 * users_email_normalized; UNIQUE (tenant_id, email) stays per tenant. Run
 * against the local database after `supabase db reset`.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();

const world = new TestWorld(env, db);
const svc = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const extraAuthIds: string[] = [];

afterAll(async () => {
  try {
    await Promise.allSettled(extraAuthIds.map((id) => svc.auth.admin.deleteUser(id)));
    await world.cleanup();
  } finally {
    await db.end();
  }
});

const insertUser = (tenantId: string, email: string) =>
  db.query(
    `INSERT INTO public.users (id, tenant_id, email, first_name, last_name, status)
     VALUES ($1, $2, $3, 'Correo', 'Normalizado', 'ACTIVE')`,
    [randomUUID(), tenantId, email],
  );

const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20261127010000_d57_email_normalized.sql"),
  "utf-8",
);

/** One statement of the migration, found by a pattern anchored at the start of a line. */
function statement(pattern: RegExp, mustContain: string): string {
  const found = MIGRATION.match(pattern);
  if (!found || !found[0].includes(mustContain)) throw new Error(`statement not found in the migration: ${pattern}`);
  return found[0];
}
// Step 1, the DO block that refuses emails colliding within a tenant; step 2, the backfill; step 4, the CHECK.
const collisionCheck = () => statement(/^DO \$\$[\s\S]*?^END \$\$;/m, "D57: some users of a tenant");
const backfill = () => statement(/^UPDATE public\.users\b[\s\S]*?;$/m, "lower(btrim(email))");
const addCheck = () => statement(/^ALTER TABLE public\.users\s+ADD CONSTRAINT users_email_normalized[\s\S]*?;$/m, "CHECK");

/** Runs `body` in a transaction that is always rolled back, without the CHECK, as before D57. */
async function beforeD57(body: () => Promise<void>) {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL lock_timeout = '5s'");
    await db.query("ALTER TABLE public.users DROP CONSTRAINT users_email_normalized");
    await body();
  } finally {
    await db.query("ROLLBACK");
  }
}

describe("public.users.email in one form (D57)", () => {
  it("normalizes the rows that are not, leaves the others untouched, and then holds the CHECK", async () => {
    const tenant = await world.createTenant();
    const local = `it-${randomUUID()}`;
    await beforeD57(async () => {
      await insertUser(tenant.id, `  ${local.toUpperCase()}@Example.TEST `);
      const { rows: before } = await db.query(
        "SELECT id, email, updated_at FROM public.users WHERE tenant_id = $1 ORDER BY id",
        [tenant.id],
      );
      await db.query(collisionCheck());
      await db.query(backfill());
      await db.query(addCheck());
      const { rows: after } = await db.query(
        "SELECT id, email, updated_at FROM public.users WHERE tenant_id = $1 ORDER BY id",
        [tenant.id],
      );
      const dirty = before.find((r) => r.email.startsWith(" "))!;
      expect(after.find((r) => r.id === dirty.id)!.email).toBe(`${local}@example.test`);
      const others = before.filter((r) => r.id !== dirty.id);
      expect(others.length).toBeGreaterThanOrEqual(3); // the tenant's admin, manager and employee
      for (const row of others) {
        expect(after.find((r) => r.id === row.id)).toEqual(row);
      }
      await db.query("SAVEPOINT after_check");
      await expect(insertUser(tenant.id, `${local}-2@Example.test`)).rejects.toThrow(/users_email_normalized/);
      await db.query("ROLLBACK TO SAVEPOINT after_check");
    });
  });

  it("rejects an email with upper case or surrounding spaces", async () => {
    const tenant = await world.createTenant();
    const local = `it-${randomUUID()}`;
    for (const email of [`${local}@Example.test`, ` ${local}@example.test`, `${local}@example.test `]) {
      await expect(insertUser(tenant.id, email)).rejects.toThrow(/users_email_normalized/);
    }
    await insertUser(tenant.id, `${local}@example.test`);
  });

  it("keeps two users of one tenant from sharing an email that differs only in case: the CHECK rejects the variant, the UNIQUE the copy", async () => {
    const tenant = await world.createTenant();
    const email = `it-${randomUUID()}@example.test`;
    await insertUser(tenant.id, email);
    await expect(insertUser(tenant.id, email.toUpperCase())).rejects.toThrow(/users_email_normalized/);
    await expect(insertUser(tenant.id, email)).rejects.toThrow(/users_tenant_id_email_key/);
  });

  it("still allows the same email in two tenants", async () => {
    const [a, b] = [await world.createTenant(), await world.createTenant()];
    const email = `it-${randomUUID()}@example.test`;
    await insertUser(a.id, email);
    await insertUser(b.id, email);
    const { rows } = await db.query("SELECT count(*)::int AS n FROM public.users WHERE email = $1", [email]);
    expect(rows[0].n).toBe(2);
  });

  it("matches auth.users.email for every user with an auth_uid, and reports the rows left out", async () => {
    await world.createTenant();
    // Left out and reported: rows without auth_uid, rows whose auth_uid has no auth account left (fixtures
    // of other suites), and anonymized users (D10 rewrites public.users; auth.users keeps the address).
    const { rows } = await db.query(`
      SELECT count(*) FILTER (WHERE au.id IS NOT NULL AND NOT u.is_anonymized)::int                 AS linked,
             count(*) FILTER (WHERE au.id IS NOT NULL AND NOT u.is_anonymized AND u.email <> au.email)::int AS different,
             count(*) FILTER (WHERE u.auth_uid IS NULL)::int                                        AS without_auth,
             count(*) FILTER (WHERE u.auth_uid IS NOT NULL AND au.id IS NULL)::int                  AS no_auth_account,
             count(*) FILTER (WHERE au.id IS NOT NULL AND u.is_anonymized)::int                     AS anonymized
      FROM public.users u
      LEFT JOIN auth.users au ON au.id = u.auth_uid`);
    const { linked, different, without_auth, no_auth_account, anonymized } = rows[0];
    console.log(
      `D57: ${linked} users compared with auth.users, ${different} different; left out: ${without_auth} without auth_uid, ${no_auth_account} with an auth_uid whose account no longer exists, ${anonymized} anonymized`,
    );
    expect(linked).toBeGreaterThan(0);
    expect(different).toBe(0);
  });

  it("relies on GoTrue storing a new account's email in lower case", async () => {
    const mixed = `IT-${randomUUID()}@Example.Test`;
    const { data, error } = await svc.auth.admin.createUser({ email: mixed, password: randomUUID(), email_confirm: true });
    expect(error).toBeNull();
    extraAuthIds.push(data.user!.id);
    const { rows } = await db.query("SELECT email FROM auth.users WHERE id = $1", [data.user!.id]);
    expect(rows[0].email).toBe(mixed.toLowerCase());
  });

  it("stops the migration, changing nothing, when normalizing would merge two users of a tenant", async () => {
    const tenant = await world.createTenant();
    const local = `it-${randomUUID()}`;
    await beforeD57(async () => {
      await insertUser(tenant.id, `${local}@example.test`);
      await insertUser(tenant.id, ` ${local.toUpperCase()}@EXAMPLE.test`);
      await db.query("SAVEPOINT before_check");
      await expect(db.query(collisionCheck())).rejects.toThrow(
        new RegExp(`D57: some users of a tenant have emails that differ only in case.*Nothing was changed, merged or deleted.*tenant ${tenant.id}: users `),
      );
      await db.query("ROLLBACK TO SAVEPOINT before_check");
      const { rows } = await db.query(
        "SELECT email FROM public.users WHERE tenant_id = $1 AND lower(btrim(email)) = $2 ORDER BY email COLLATE \"C\"",
        [tenant.id, `${local}@example.test`],
      );
      expect(rows.map((r) => r.email)).toEqual([` ${local.toUpperCase()}@EXAMPLE.test`, `${local}@example.test`]);
    });
    const { rows } = await db.query(
      "SELECT 1 FROM pg_constraint WHERE conname = 'users_email_normalized' AND conrelid = 'public.users'::regclass",
    );
    expect(rows).toHaveLength(1);
  });
});
