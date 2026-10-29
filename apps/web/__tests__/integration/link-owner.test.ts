import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld } from "./helpers/world";

/**
 * Verifies the SQL logic from scripts/link-owner.sh is idempotent:
 * running it twice produces the same rows without errors.
 */

const DEMO_TENANT = "a0000000-0000-0000-0000-000000000001";

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();

const world = new TestWorld(env, db);

afterAll(async () => {
  await world.cleanup();
  await db.end();
});

async function linkOwnerSql(ownerId: string, email: string): Promise<void> {
  await db.query(
    `
    UPDATE public.users SET auth_uid = $1::uuid, status = 'ACTIVE', updated_at = now()
    WHERE tenant_id = $3::uuid AND lower(email) = lower($2) AND auth_uid IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.users WHERE auth_uid = $1::uuid)`,
    [ownerId, email, DEMO_TENANT],
  );

  await db.query(
    `INSERT INTO public.users (auth_uid, tenant_id, email, first_name, last_name, status, hire_date)
     SELECT au.id, $2::uuid, $3,
            coalesce(nullif(au.raw_user_meta_data->>'first_name', ''), 'Owner'),
            coalesce(nullif(au.raw_user_meta_data->>'last_name', ''), 'Account'),
            'ACTIVE', now()
     FROM auth.users au WHERE au.id = $1::uuid
     ON CONFLICT (auth_uid) DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id,
       status    = 'ACTIVE'`,
    [ownerId, DEMO_TENANT, email],
  );

  await db.query(
    `INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role, is_active)
     VALUES ($1::uuid, $2::uuid, 'owner', true)
     ON CONFLICT (user_id, tenant_id) DO UPDATE SET
       app_role  = 'owner',
       is_active = true`,
    [ownerId, DEMO_TENANT],
  );

  await db.query(
    `INSERT INTO public.user_settings (user_id, active_tenant_id)
     VALUES ($1::uuid, $2::uuid)
     ON CONFLICT (user_id) DO UPDATE SET
       active_tenant_id = EXCLUDED.active_tenant_id`,
    [ownerId, DEMO_TENANT],
  );

  await db.query(
    `INSERT INTO public.ec_personal_information (tenant_id, user_id, start_date, first_name, last_name, event_reason)
     SELECT u.tenant_id, u.id, current_date, u.first_name, u.last_name, 'Hire'
     FROM public.users u
     WHERE u.auth_uid = $1::uuid
       AND NOT EXISTS (
         SELECT 1 FROM public.ec_personal_information pi
         WHERE pi.user_id = u.id AND pi.tenant_id = u.tenant_id AND pi.end_date IS NULL
       )`,
    [ownerId],
  );

  await db.query(
    `INSERT INTO public.ec_job_information (tenant_id, user_id, start_date, job_title, event_reason)
     SELECT u.tenant_id, u.id, current_date, 'Owner', 'Hire'
     FROM public.users u
     WHERE u.auth_uid = $1::uuid
       AND NOT EXISTS (
         SELECT 1 FROM public.ec_job_information ji
         WHERE ji.user_id = u.id AND ji.tenant_id = u.tenant_id AND ji.end_date IS NULL
       )`,
    [ownerId],
  );
}

async function countOwnerRecords(ownerId: string) {
  const users = await db.query(
    "SELECT count(*)::int AS n FROM public.users WHERE auth_uid = $1::uuid",
    [ownerId],
  );
  const memberships = await db.query(
    "SELECT count(*)::int AS n FROM public.user_tenant_memberships WHERE user_id = $1::uuid AND tenant_id = $2::uuid",
    [ownerId, DEMO_TENANT],
  );
  const settings = await db.query(
    "SELECT count(*)::int AS n FROM public.user_settings WHERE user_id = $1::uuid",
    [ownerId],
  );
  const ecPi = await db.query(
    `SELECT count(*)::int AS n FROM public.ec_personal_information pi
     JOIN public.users u ON u.id = pi.user_id AND u.tenant_id = pi.tenant_id
     WHERE u.auth_uid = $1::uuid AND pi.end_date IS NULL`,
    [ownerId],
  );
  const ecJi = await db.query(
    `SELECT count(*)::int AS n FROM public.ec_job_information ji
     JOIN public.users u ON u.id = ji.user_id AND u.tenant_id = ji.tenant_id
     WHERE u.auth_uid = $1::uuid AND ji.end_date IS NULL`,
    [ownerId],
  );
  return {
    users: users.rows[0].n,
    memberships: memberships.rows[0].n,
    settings: settings.rows[0].n,
    ecPi: ecPi.rows[0].n,
    ecJi: ecJi.rows[0].n,
  };
}

describe("link-owner idempotency", () => {
  it("creates all records on first run and changes nothing on second run", async () => {
    const { authId, email } = await world.createAuthUser();

    await linkOwnerSql(authId, email);
    const first = await countOwnerRecords(authId);

    expect(first.users).toBe(1);
    expect(first.memberships).toBe(1);
    expect(first.settings).toBe(1);
    expect(first.ecPi).toBe(1);
    expect(first.ecJi).toBe(1);

    await linkOwnerSql(authId, email);
    const second = await countOwnerRecords(authId);

    expect(second).toEqual(first);
  });

  it("sets app_role to owner and is_active to true", async () => {
    const { authId, email } = await world.createAuthUser();
    await linkOwnerSql(authId, email);

    const { rows } = await db.query(
      "SELECT app_role, is_active FROM public.user_tenant_memberships WHERE user_id = $1 AND tenant_id = $2",
      [authId, DEMO_TENANT],
    );
    expect(rows[0]).toMatchObject({ app_role: "owner", is_active: true });
  });

  it("creates ec_job_information with title Owner", async () => {
    const { authId, email } = await world.createAuthUser();
    await linkOwnerSql(authId, email);

    const { rows } = await db.query(
      `SELECT ji.job_title FROM public.ec_job_information ji
       JOIN public.users u ON u.id = ji.user_id AND u.tenant_id = ji.tenant_id
       WHERE u.auth_uid = $1 AND ji.end_date IS NULL`,
      [authId],
    );
    expect(rows[0].job_title).toBe("Owner");
  });
});
