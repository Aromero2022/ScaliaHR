import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";
import { formatDateOnly } from "@/lib/format/dates";

/**
 * D42: formatDateOnly() reads the date-only timestamptz columns
 * (performance_goals.period_start, period_end and due_date, users.hire_date)
 * as midnight UTC. That holds only while the Postgres sessions run in UTC,
 * for the writers (seed, the app through the Data API) and the readers.
 */

const UTC_REQUIRED =
  "Postgres sessions must run in UTC: formatDateOnly() (D42) reads the date-only timestamptz columns as midnight UTC. " +
  "If the database time zone changed, convert those columns to date (Phases 14 and 16) before relying on another zone.";

const env = integrationEnv();
const prismaAppUrl = process.env.PRISMA_APP_TEST_DB_URL;
if (!prismaAppUrl) throw new Error("PRISMA_APP_TEST_DB_URL is not set: source scripts/supabase-test-env.sh");

const db = new pg.Client({ connectionString: env.dbUrl });
const app = new pg.Client({ connectionString: prismaAppUrl });
await db.connect();
await app.connect();
const world = new TestWorld(env, db);
let tenant: TestTenant;

beforeAll(async () => {
  tenant = await world.createTenant();
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await app.end();
    await db.end();
  }
});

describe("UTC sessions for the date-only columns (D42)", () => {
  it("runs the sessions of the migration role and of prisma_app in UTC", async () => {
    for (const [who, client] of [["postgres", db], ["prisma_app", app]] as const) {
      const { rows } = await client.query<{ TimeZone: string }>("SHOW timezone");
      expect(rows[0].TimeZone, `${who}: ${UTC_REQUIRED}`).toBe("UTC");
    }
    const { rows } = await db.query<{ setting: string }>("SELECT setting FROM pg_settings WHERE name = 'TimeZone'");
    expect(rows[0].setting, UTC_REQUIRED).toBe("UTC");
  });

  it("stores a goal written through the Data API at midnight UTC and returns it so", async () => {
    const client = tenant.employee.client;
    const { data: inserted, error } = await client
      .from("performance_goals")
      .insert({
        tenant_id: tenant.id,
        user_id: tenant.employee.userId,
        title: "D42 objetivo",
        status: "ON_TRACK",
        period_start: "2026-01-01",
        period_end: "2026-12-31",
        due_date: "2026-12-31",
      })
      .select("id, period_start, period_end, due_date")
      .single();
    expect(error).toBeNull();
    expect(inserted, UTC_REQUIRED).toMatchObject({
      period_start: "2026-01-01T00:00:00+00:00",
      period_end: "2026-12-31T00:00:00+00:00",
      due_date: "2026-12-31T00:00:00+00:00",
    });

    const { rows } = await db.query<{ utc: string }>(
      "SELECT to_char(period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS utc FROM public.performance_goals WHERE id = $1",
      [inserted!.id],
    );
    expect(rows[0].utc, UTC_REQUIRED).toBe("2026-01-01 00:00");
    expect(formatDateOnly(inserted!.period_start)).toBe("1 ene 2026");
    expect(formatDateOnly(inserted!.due_date)).toBe("31 dic 2026");
  });

  it("returns a hire date written like the seed (a date cast to timestamptz) as that day", async () => {
    await db.query("UPDATE public.users SET hire_date = '2021-01-10'::timestamptz WHERE id = $1", [tenant.employee.userId]);
    const { data, error } = await tenant.employee.client.from("users").select("hire_date").eq("id", tenant.employee.userId).single();
    expect(error).toBeNull();
    expect(data?.hire_date, UTC_REQUIRED).toBe("2021-01-10T00:00:00+00:00");
    expect(formatDateOnly(data!.hire_date)).toBe("10 ene 2021");
  });
});
