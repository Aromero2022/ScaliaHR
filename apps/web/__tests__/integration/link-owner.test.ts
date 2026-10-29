import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld } from "./helpers/world";

/**
 * Verifies the SQL logic from scripts/link-owner.sh against the local DB.
 * Mirrors the actual script SQL so failures here mean the script drifted.
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

function deterministicEmployeeId(authId: string): string {
  const hex8 = authId.slice(0, 8);
  let val = parseInt(hex8, 16);
  if (val >= 0x80000000) val = val - 0x100000000;
  const num = (Math.abs(val) % 9999) + 1;
  return `OWN-${String(num).padStart(4, "0")}`;
}

async function linkOwnerSql(ownerId: string, email: string): Promise<void> {
  await db.query(
    `UPDATE public.users SET auth_uid = $1::uuid, status = 'ACTIVE', updated_at = now()
     WHERE tenant_id = $3::uuid AND lower(email) = lower($2) AND auth_uid IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.users WHERE auth_uid = $1::uuid)`,
    [ownerId, email, DEMO_TENANT],
  );

  await db.query(
    `INSERT INTO public.users (auth_uid, tenant_id, email, first_name, last_name, status, hire_date, employee_id, department_id)
     SELECT au.id, $2::uuid, $3,
            coalesce(nullif(au.raw_user_meta_data->>'first_name', ''), 'Owner'),
            coalesce(nullif(au.raw_user_meta_data->>'last_name', ''), 'Account'),
            'ACTIVE', now(),
            'OWN-' || lpad(abs(('x' || left(au.id::text, 8))::bit(32)::int % 9999 + 1)::text, 4, '0'),
            (SELECT id FROM public.departments WHERE tenant_id = $2::uuid ORDER BY created_at LIMIT 1)
     FROM auth.users au WHERE au.id = $1::uuid
     ON CONFLICT (auth_uid) DO UPDATE SET
       tenant_id     = EXCLUDED.tenant_id,
       status        = 'ACTIVE',
       employee_id   = COALESCE(public.users.employee_id, EXCLUDED.employee_id),
       department_id = COALESCE(public.users.department_id, EXCLUDED.department_id)`,
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

  // Owner group memberships (via role_grants)
  await db.query(
    `INSERT INTO public.group_members (tenant_id, group_id, user_id)
     SELECT rg.tenant_id, rg.granted_group_id, u.id
     FROM public.users u
     JOIN public.role_grants rg ON rg.tenant_id = u.tenant_id
     JOIN public.permission_roles pr ON pr.id = rg.role_id AND pr.tenant_id = rg.tenant_id
     WHERE u.auth_uid = $1::uuid AND lower(pr.name) = 'owner'
     ON CONFLICT (group_id, user_id) DO NOTHING`,
    [ownerId],
  );

  // Employee group memberships (via role_grants)
  await db.query(
    `INSERT INTO public.group_members (tenant_id, group_id, user_id)
     SELECT rg.tenant_id, rg.granted_group_id, u.id
     FROM public.users u
     JOIN public.role_grants rg ON rg.tenant_id = u.tenant_id
     JOIN public.permission_roles pr ON pr.id = rg.role_id AND pr.tenant_id = rg.tenant_id
     WHERE u.auth_uid = $1::uuid AND lower(pr.name) LIKE 'employee%'
     ON CONFLICT (group_id, user_id) DO NOTHING`,
    [ownerId],
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
    `INSERT INTO public.ec_job_information (tenant_id, user_id, start_date, job_title, event_reason, department_id)
     SELECT u.tenant_id, u.id, current_date, 'Director General', 'Hire', u.department_id
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
  const groups = await db.query(
    `SELECT count(*)::int AS n FROM public.group_members gm
     JOIN public.users u ON u.id = gm.user_id AND u.tenant_id = gm.tenant_id
     WHERE u.auth_uid = $1::uuid`,
    [ownerId],
  );
  return {
    users: users.rows[0].n,
    memberships: memberships.rows[0].n,
    settings: settings.rows[0].n,
    ecPi: ecPi.rows[0].n,
    ecJi: ecJi.rows[0].n,
    groups: groups.rows[0].n,
  };
}

describe("link-owner integration", () => {
  it("creates all records on first run and changes nothing on second run", async () => {
    const { authId, email } = await world.createAuthUser();

    await linkOwnerSql(authId, email);
    const first = await countOwnerRecords(authId);

    expect(first.users).toBe(1);
    expect(first.memberships).toBe(1);
    expect(first.settings).toBe(1);
    expect(first.ecPi).toBe(1);
    expect(first.ecJi).toBe(1);
    expect(first.groups).toBeGreaterThanOrEqual(1);

    await linkOwnerSql(authId, email);
    const second = await countOwnerRecords(authId);

    expect(second).toEqual(first);
  });

  it("places the owner in the admin group (Owner role) AND the employee group (Employee role)", async () => {
    const { authId, email } = await world.createAuthUser();
    await linkOwnerSql(authId, email);

    const { rows: ownerGroups } = await db.query(
      `SELECT pr.name AS role_name
       FROM public.group_members gm
       JOIN public.users u ON u.id = gm.user_id AND u.tenant_id = gm.tenant_id
       JOIN public.role_grants rg ON rg.granted_group_id = gm.group_id AND rg.tenant_id = gm.tenant_id
       JOIN public.permission_roles pr ON pr.id = rg.role_id AND pr.tenant_id = rg.tenant_id
       WHERE u.auth_uid = $1::uuid`,
      [authId],
    );
    const roleNames = ownerGroups.map((r) => r.role_name.toLowerCase());
    expect(roleNames).toContain("owner");
    expect(roleNames.some((n) => n.startsWith("employee"))).toBe(true);
  });

  it("grants admin_center.access view permission (can check)", async () => {
    const { authId, email } = await world.createAuthUser();
    await linkOwnerSql(authId, email);

    const { rows: userId } = await db.query(
      "SELECT id FROM public.users WHERE auth_uid = $1::uuid LIMIT 1",
      [authId],
    );
    expect(userId.length).toBe(1);

    const { rows: perm } = await db.query(
      `SELECT 1 FROM public.role_permissions rp
       JOIN public.role_grants rg ON rg.role_id = rp.role_id AND rg.tenant_id = rp.tenant_id
       JOIN public.group_members gm ON gm.group_id = rg.granted_group_id
       WHERE gm.user_id = $1::uuid
         AND rp.permission_key = 'admin_center.access'
         AND rp.action = 'view'`,
      [userId[0].id],
    );
    expect(perm.length).toBeGreaterThanOrEqual(1);
  });

  it("creates ec_job_information with 'Director General' and a department", async () => {
    const { authId, email } = await world.createAuthUser();
    await linkOwnerSql(authId, email);

    const { rows } = await db.query(
      `SELECT ji.job_title, ji.department_id
       FROM public.ec_job_information ji
       JOIN public.users u ON u.id = ji.user_id AND u.tenant_id = ji.tenant_id
       WHERE u.auth_uid = $1 AND ji.end_date IS NULL`,
      [authId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].job_title).toBe("Director General");
    expect(rows[0].department_id).not.toBeNull();
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

  it("generates a deterministic employee_id from the auth user id", async () => {
    const { authId, email } = await world.createAuthUser();
    await linkOwnerSql(authId, email);

    const { rows } = await db.query(
      "SELECT employee_id FROM public.users WHERE auth_uid = $1::uuid",
      [authId],
    );
    expect(rows[0].employee_id).toMatch(/^OWN-\d{4}$/);

    const expected = deterministicEmployeeId(authId);
    expect(rows[0].employee_id).toBe(expected);
  });
});
