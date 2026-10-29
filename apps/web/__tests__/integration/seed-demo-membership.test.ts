import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { integrationEnv } from "./helpers/env";

const ELENA_AUTH_ID = "f0000000-0000-0000-0000-000000000001";
const DEMO_TENANT_ID = "a0000000-0000-0000-0000-000000000001";

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
const svc = createClient(env.supabaseUrl, env.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await db.connect();

async function ensureElenaAuthUser(): Promise<void> {
  await db.query(
    `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at,
                              raw_app_meta_data, raw_user_meta_data, confirmation_token)
     VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'elena.demo@acme-corp.test',
             crypt('DemoPass123!', gen_salt('bf')),
             now(), now(), now(),
             '{"provider":"email","providers":["email"]}'::jsonb,
             '{}'::jsonb, '')
     ON CONFLICT (id) DO NOTHING`,
    [ELENA_AUTH_ID],
  );
}

/**
 * Runs only the Elena membership block from seed.sql — the exact same SQL the
 * seed uses — so we can test it mid-suite without the full seed's self-check
 * conflicting with rows other integration tests have created.
 */
async function runElenaBlock(): Promise<void> {
  await db.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM auth.users WHERE id = 'f0000000-0000-0000-0000-000000000001') THEN
        INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role)
        VALUES ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'hr_admin')
        ON CONFLICT DO NOTHING;

        INSERT INTO public.user_settings (user_id, active_tenant_id)
        VALUES ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001')
        ON CONFLICT DO NOTHING;
      END IF;
    END $$;
  `);
}

afterAll(async () => {
  await db.query(
    "DELETE FROM public.user_settings WHERE user_id = $1",
    [ELENA_AUTH_ID],
  );
  await db.query(
    "DELETE FROM public.user_tenant_memberships WHERE user_id = $1",
    [ELENA_AUTH_ID],
  );
  await svc.auth.admin.deleteUser(ELENA_AUTH_ID);
  await db.end();
});

describe("seed.sql demo membership for Elena", () => {
  it("creates membership with hr_admin role when auth user exists", async () => {
    await ensureElenaAuthUser();
    await runElenaBlock();

    const { rows } = await db.query<{ app_role: string }>(
      `SELECT app_role FROM public.user_tenant_memberships
       WHERE user_id = $1 AND tenant_id = $2`,
      [ELENA_AUTH_ID, DEMO_TENANT_ID],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].app_role).toBe("hr_admin");
  });

  it("is idempotent: second run does not duplicate or change membership", async () => {
    await runElenaBlock();

    const { rows } = await db.query<{ app_role: string }>(
      `SELECT app_role FROM public.user_tenant_memberships
       WHERE user_id = $1 AND tenant_id = $2`,
      [ELENA_AUTH_ID, DEMO_TENANT_ID],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].app_role).toBe("hr_admin");
  });

  it("rejects the legacy 'admin' value for the same INSERT pattern", async () => {
    await expect(
      db.query(
        `INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role)
         VALUES ($1, $2, 'admin')`,
        [ELENA_AUTH_ID, DEMO_TENANT_ID],
      ),
    ).rejects.toThrow(/app_role_allowed/);
  });
});
