import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

/**
 * D42: public.tenant_time_zone() gives the server's prisma_app the
 * platform.timezone of one tenant, and nothing else, to nobody else.
 * getTenantTimeZone() validates it and falls back to America/Mexico_City.
 */

const env = integrationEnv();
const prismaAppUrl = process.env.PRISMA_APP_TEST_DB_URL;
if (!prismaAppUrl) throw new Error("PRISMA_APP_TEST_DB_URL is not set: source scripts/supabase-test-env.sh");
process.env.DATABASE_URL = prismaAppUrl;

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));

const { getTenantTimeZone, readTenantTimeZone } = await import("@/lib/tenant/get-tenant-time-zone");
const { prisma } = await import("@/lib/db/tenant-client");

const DEMO_TENANT = "a0000000-0000-0000-0000-000000000001";

const db = new pg.Client({ connectionString: env.dbUrl });
const app = new pg.Client({ connectionString: prismaAppUrl });
await db.connect();
await app.connect();
const world = new TestWorld(env, db);
let a: TestTenant;
let b: TestTenant;
let withoutZone: TestTenant;

const zoneAsPrismaApp = async (tenantId: string) =>
  (await app.query<{ tz: string | null }>("SELECT public.tenant_time_zone($1) AS tz", [tenantId])).rows[0].tz;

beforeAll(async () => {
  [a, b, withoutZone] = [await world.createTenant(), await world.createTenant(), await world.createTenant()];
  await db.query(
    `INSERT INTO public.system_configurations (tenant_id, key, value_json) VALUES
       ($1, 'platform.timezone', '"America/Cancun"'), ($1, 'platform.locale', '"es"'),
       ($1, 'security.session_timeout_minutes', '30'),
       ($2, 'platform.timezone', '"Asia/Tokyo"')`,
    [a.id, b.id],
  );
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await prisma.$disconnect();
    await app.end();
    await db.end();
  }
});

describe("tenant_time_zone (D42)", () => {
  it("gives prisma_app the demo tenant's zone", async () => {
    expect(await zoneAsPrismaApp(DEMO_TENANT)).toBe("America/Mexico_City");
    expect(await readTenantTimeZone(DEMO_TENANT)).toEqual({ timeZone: "America/Mexico_City", isFallback: false });
  });

  it("cannot be called from the Data API, signed in or not (42501)", async () => {
    const anon = createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false } });
    for (const [who, client] of [["anon", anon], ["employee", a.employee.client], ["tenant admin", a.admin.client]] as const) {
      const { data, error } = await client.rpc("tenant_time_zone", { p_tenant_id: a.id });
      expect(error?.code, who).toBe("42501");
      expect(data, who).toBeNull();
    }
  });

  it("gives each tenant its own zone, never another's", async () => {
    expect(await zoneAsPrismaApp(a.id)).toBe("America/Cancun");
    expect(await zoneAsPrismaApp(b.id)).toBe("Asia/Tokyo");
    expect(await readTenantTimeZone(a.id)).toEqual({ timeZone: "America/Cancun", isFallback: false });
    expect(await getTenantTimeZone(b.id)).toEqual({ timeZone: "Asia/Tokyo", isFallback: false });
  });

  it("returns null for a tenant without the key or an unknown tenant, and getTenantTimeZone falls back", async () => {
    expect(await zoneAsPrismaApp(withoutZone.id)).toBeNull();
    expect(await zoneAsPrismaApp("00000000-0000-0000-0000-00000000d42a")).toBeNull();
    expect(await getTenantTimeZone(withoutZone.id)).toEqual({ timeZone: "America/Mexico_City", isFallback: true });
  });

  it("falls back for a stored value that is not a zone", async () => {
    await db.query(`UPDATE public.system_configurations SET value_json = '"Mars/Olympus"' WHERE tenant_id = $1 AND key = 'platform.timezone'`, [b.id]);
    try {
      expect(await zoneAsPrismaApp(b.id)).toBe("Mars/Olympus");
      expect(await readTenantTimeZone(b.id)).toEqual({ timeZone: "America/Mexico_City", isFallback: true });
    } finally {
      await db.query(`UPDATE public.system_configurations SET value_json = '"Asia/Tokyo"' WHERE tenant_id = $1 AND key = 'platform.timezone'`, [b.id]);
    }
  });

  it("is SQL, stable, SECURITY DEFINER with an empty search_path, one uuid in and text out, run only by prisma_app", async () => {
    const { rows } = await db.query(`
      SELECT p.prosecdef, p.provolatile, p.proconfig, l.lanname,
             pg_get_function_identity_arguments(p.oid) AS args, p.prorettype::regtype::text AS returns,
             has_function_privilege('prisma_app', p.oid, 'EXECUTE') AS prisma_app,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = 'public.tenant_time_zone(uuid)'::regprocedure`);
    expect(rows).toEqual([
      {
        prosecdef: true,
        provolatile: "s",
        proconfig: ['search_path=""'],
        lanname: "sql",
        args: "p_tenant_id uuid",
        returns: "text",
        prisma_app: true,
        authenticated: false,
        anon: false,
        service_role: false,
        public: false,
      },
    ]);
    const { rows: overloads } = await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'tenant_time_zone'`);
    expect(overloads[0].n).toBe(1);
  });
});
