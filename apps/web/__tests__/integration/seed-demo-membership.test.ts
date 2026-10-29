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

async function loadSeed(): Promise<void> {
  const { execSync } = await import("node:child_process");
  execSync(`psql "${env.dbUrl}" -v ON_ERROR_STOP=1 -f supabase/seed.sql`, {
    cwd: process.env.REPO_ROOT ?? `${process.cwd()}/../..`,
    stdio: "pipe",
  });
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
  it("creates Elena's auth user and loads seed with hr_admin role", async () => {
    await ensureElenaAuthUser();
    await loadSeed();

    const { rows } = await db.query<{ app_role: string }>(
      `SELECT app_role FROM public.user_tenant_memberships
       WHERE user_id = $1 AND tenant_id = $2`,
      [ELENA_AUTH_ID, DEMO_TENANT_ID],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].app_role).toBe("hr_admin");
  });

  it("is idempotent: second load does not duplicate or change membership", async () => {
    await loadSeed();

    const { rows } = await db.query<{ app_role: string }>(
      `SELECT app_role FROM public.user_tenant_memberships
       WHERE user_id = $1 AND tenant_id = $2`,
      [ELENA_AUTH_ID, DEMO_TENANT_ID],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].app_role).toBe("hr_admin");
  });
});
