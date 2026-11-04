import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { updateSession } from "@/lib/supabase/middleware";
import { supabaseServerTarget } from "@/lib/supabase/server-url";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

/**
 * D21 — the real middleware against the local stack: real sessions, real RLS.
 * A user of one tenant cannot get in through another tenant's subdomain or
 * company code, and the refusal never tells which case it was.
 */

const env = integrationEnv();
process.env.NEXT_PUBLIC_SUPABASE_URL = env.supabaseUrl;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.anonKey;
process.env.APP_BASE_URL = "http://localhost:3000";
delete process.env.SUPABASE_INTERNAL_URL;

const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

let a: TestTenant;
let b: TestTenant;
let suspended: TestTenant;
let cookieA = "";
let cookieSuspended = "";

/** Session cookies exactly as @supabase/ssr writes them for the browser. */
async function sessionCookie(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const target = supabaseServerTarget();
  const client = createServerClient(target.url, env.anonKey, {
    cookieOptions: { name: target.cookieName },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await client.auth.setSession(await world.session(email));
  if (error) throw new Error(`setSession failed: ${error.message}`);
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function visit(host: string, path: string, cookie = "") {
  const headers = new Headers({ host });
  if (cookie) headers.set("cookie", cookie);
  const res = await updateSession(new NextRequest(`http://${host}${path}`, { headers }));
  return { status: res.status, location: res.headers.get("location"), body: await res.text() };
}

beforeAll(async () => {
  a = await world.createTenant();
  b = await world.createTenant();
  suspended = await world.createTenant();
  cookieA = await sessionCookie(a.employee.email);
  // Signed in before the suspension: the token still names the tenant (D21).
  cookieSuspended = await sessionCookie(suspended.employee.email);
  await db.query("UPDATE public.tenants SET suspended_at = now() WHERE id = $1", [suspended.id]);
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

describe("tenant by subdomain (D21)", () => {
  it("lets a user in through their own tenant's subdomain", async () => {
    const res = await visit(`${a.slug}.localhost:3000`, "/dashboard", cookieA);
    expect(res.status).toBe(200);
    expect(res.location).toBeNull();
  });

  it("refuses the same user on another tenant's subdomain", async () => {
    const res = await visit(`${b.slug}.localhost:3000`, "/dashboard", cookieA);
    expect(res.status).toBe(404);
  });

  it("answers another tenant, a nonexistent one and a suspended one exactly alike", async () => {
    const other = await visit(`${b.slug}.localhost:3000`, "/dashboard", cookieA);
    const missing = await visit("no-such-tenant.localhost:3000", "/dashboard", cookieA);
    const paused = await visit(`${suspended.slug}.localhost:3000`, "/dashboard", cookieSuspended);
    expect(missing).toEqual(other);
    expect(paused).toEqual(other);
  });

  it("refuses a suspended tenant's user on the app host too, while the old token lasts", async () => {
    const res = await visit("localhost:3000", "/dashboard", cookieSuspended);
    expect(res.status).toBe(404);
  });

  it("gives anonymous visitors the same login redirect whether the tenant exists or not", async () => {
    const existing = await visit(`${b.slug}.localhost:3000`, "/dashboard");
    const missing = await visit("no-such-tenant.localhost:3000", "/dashboard");
    expect(existing.status).toBe(307);
    expect(new URL(existing.location!).pathname).toBe("/login");
    expect(new URL(missing.location!).pathname).toBe("/login");
    expect({ ...missing, location: null }).toEqual({ ...existing, location: null });
  });

  it("serves the login page on any subdomain without looking the tenant up", async () => {
    const existing = await visit(`${b.slug}.localhost:3000`, "/login");
    const missing = await visit("no-such-tenant.localhost:3000", "/login");
    expect(existing.status).toBe(200);
    expect(missing).toEqual(existing);
  });
});

describe("tenant by company code (D21)", () => {
  it("lets a user in with their own company code or none", async () => {
    expect((await visit("localhost:3000", "/dashboard", `${cookieA}; scalia_company=${a.slug}`)).status).toBe(200);
    expect((await visit("localhost:3000", "/dashboard", cookieA)).status).toBe(200);
  });

  it("refuses another tenant's or a nonexistent company code with the same 404", async () => {
    const other = await visit("localhost:3000", "/dashboard", `${cookieA}; scalia_company=${b.slug}`);
    const missing = await visit("localhost:3000", "/dashboard", `${cookieA}; scalia_company=no-such-tenant`);
    expect(other.status).toBe(404);
    expect(missing).toEqual(other);
  });

  it("ignores the company code on a subdomain: the host wins", async () => {
    const res = await visit(`${a.slug}.localhost:3000`, "/dashboard", `${cookieA}; scalia_company=${b.slug}`);
    expect(res.status).toBe(200);
  });
});
