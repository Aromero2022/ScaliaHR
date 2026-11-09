import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { generateSync } from "otplib";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

/**
 * D28 — rate limiting against the local stack: the SQL limiter as prisma_app,
 * per-tenant limits under RLS, and the real login and MFA Server Actions
 * talking to Supabase Auth and the limiter. next/headers stands in for one
 * request at a time.
 */

const request = { headers: new Map<string, string>(), cookies: new Map<string, string>() };
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => request.headers.get(name.toLowerCase()) ?? null }),
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name)! } : undefined),
    getAll: () => [...request.cookies].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (options?.maxAge === 0) request.cookies.delete(name);
      else request.cookies.set(name, value);
    },
    delete: (name: string) => request.cookies.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const env = integrationEnv();
const prismaAppUrl = process.env.PRISMA_APP_TEST_DB_URL;
if (!prismaAppUrl) throw new Error("PRISMA_APP_TEST_DB_URL is not set: source scripts/supabase-test-env.sh");

// The actions read these when they are imported (Prisma) or called (Supabase).
process.env.DATABASE_URL = prismaAppUrl;
process.env.NEXT_PUBLIC_SUPABASE_URL = env.supabaseUrl;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.anonKey;
const { signIn } = await import("@/app/login/actions");
const { verifyMfa } = await import("@/app/(protected)/mfa/actions");
const { prisma } = await import("@/lib/db/tenant-client");

const db = new pg.Client({ connectionString: env.dbUrl });
const app = new pg.Client({ connectionString: prismaAppUrl });
await db.connect();
await app.connect();
const world = new TestWorld(env, db);
const password = (world as unknown as { password: string }).password;
let tenant: TestTenant;
let other: TestTenant;

const WRONG = "Correo o contraseña incorrectos.";
const LIMITED = /^Demasiados intentos\. Intenta de nuevo en \d+ segundos\.$/;

beforeAll(async () => {
  tenant = await world.createTenant();
  other = await world.createTenant();
});

afterAll(async () => {
  try {
    await db.query("DELETE FROM public.rate_limits WHERE action LIKE 'd28_%'");
    await world.cleanup();
  } finally {
    await prisma.$disconnect();
    await app.end();
    await db.end();
  }
});

/** A new request from its own client IP, so each test starts with full buckets. */
beforeEach(() => {
  request.headers = new Map([
    ["host", "localhost:3000"],
    ["x-forwarded-for", `198.51.100.${Math.floor(Math.random() * 250) + 1}, 203.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`],
  ]);
  request.cookies = new Map();
});

async function consume(key: string, max: number, window: number, tenantId: string | null = null, action = "d28_probe") {
  const { rows } = await app.query<{ r: number }>("SELECT public.rate_limit_consume($1, $2, $3, $4, $5) AS r", [
    key,
    action,
    max,
    window,
    tenantId,
  ]);
  return rows[0].r;
}

describe("rate_limit_consume (D28)", () => {
  it("prisma_app spends tokens and learns how long to wait", async () => {
    const key = randomUUID();
    const answers = [];
    for (let i = 0; i < 5; i++) answers.push(await consume(key, 3, 60));
    expect(answers.slice(0, 3)).toEqual([0, 0, 0]);
    for (const wait of answers.slice(3)) {
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(60);
    }
  });

  it("starts a new window once the old one ends", async () => {
    const key = randomUUID();
    await consume(key, 1, 60);
    expect(await consume(key, 1, 60)).toBeGreaterThan(0);
    await db.query("UPDATE public.rate_limits SET window_start = now() - interval '61 seconds' WHERE key = $1", [key]);
    expect(await consume(key, 1, 60)).toBe(0);
  });

  it("uses the tenant's own limit for write and api, and the default otherwise", async () => {
    await db.query(
      "INSERT INTO public.tenant_rate_limits (tenant_id, action, max_tokens, window_seconds) VALUES ($1, 'write', 1, 60)",
      [tenant.id],
    );
    const key = randomUUID();
    expect(await consume(key, 30, 60, tenant.id, "write")).toBe(0);
    expect(await consume(key, 30, 60, tenant.id, "write")).toBeGreaterThan(0);
    const otherKey = randomUUID();
    expect(await consume(otherKey, 30, 60, other.id, "write")).toBe(0);
    expect(await consume(otherKey, 30, 60, other.id, "write")).toBe(0);
    await db.query("DELETE FROM public.tenant_rate_limits WHERE tenant_id = $1", [tenant.id]);
    await db.query("DELETE FROM public.rate_limits WHERE action = 'write' AND key = ANY($1)", [[key, otherKey]]);
  });

  it("rejects a limit that would switch it off", async () => {
    await expect(consume(randomUUID(), 0, 60)).rejects.toMatchObject({ code: "22023" });
    await expect(consume(randomUUID(), 5, 86_401)).rejects.toMatchObject({ code: "22023" });
  });

  it("cannot be called from the Data API, signed in or not; check_rate_limit is gone", async () => {
    const args = { p_key: "x", p_action: "d28_probe", p_max_tokens: 1000, p_window_seconds: 60 };
    const anon = createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false } });
    for (const client of [anon, tenant.employee.client, tenant.admin.client]) {
      const { error } = await client.rpc("rate_limit_consume", args);
      expect(error?.code).toBe("42501");
    }
    const old = await tenant.employee.client.rpc("check_rate_limit", args);
    expect(old.error?.code).toBe("PGRST202");
  });
});

describe("tenant_rate_limits (D28)", () => {
  it("a tenant admin sets their own tenant's limit, within bounds", async () => {
    const { error } = await tenant.admin.client
      .from("tenant_rate_limits")
      .upsert({ tenant_id: tenant.id, action: "api", max_tokens: 50, window_seconds: 120 }, { onConflict: "tenant_id,action" });
    expect(error).toBeNull();
    const { data } = await tenant.admin.client.from("tenant_rate_limits").select("action, max_tokens, window_seconds");
    expect(data).toEqual([{ action: "api", max_tokens: 50, window_seconds: 120 }]);

    const tooHigh = await tenant.admin.client
      .from("tenant_rate_limits")
      .update({ max_tokens: 601 })
      .eq("tenant_id", tenant.id);
    expect(tooHigh.error?.code).toBe("23514");
    const login = await tenant.admin.client
      .from("tenant_rate_limits")
      .insert({ tenant_id: tenant.id, action: "login", max_tokens: 100, window_seconds: 60 });
    expect(login.error?.code).toBe("23514");
  });

  it("nobody else reads or changes it, and nobody deletes it", async () => {
    const employee = await tenant.employee.client
      .from("tenant_rate_limits")
      .insert({ tenant_id: tenant.id, action: "write", max_tokens: 600, window_seconds: 10 });
    expect(employee.error?.code).toBe("42501");
    expect((await tenant.employee.client.from("tenant_rate_limits").select("action")).data).toEqual([]);

    const otherAdmin = await other.admin.client
      .from("tenant_rate_limits")
      .update({ max_tokens: 600 })
      .eq("tenant_id", tenant.id)
      .select("action");
    expect(otherAdmin.data).toEqual([]);
    const crossInsert = await other.admin.client
      .from("tenant_rate_limits")
      .insert({ tenant_id: tenant.id, action: "write", max_tokens: 600, window_seconds: 10 });
    expect(crossInsert.error?.code).toBe("42501");

    // D46: authenticated holds no DELETE privilege.
    const removed = await tenant.admin.client.from("tenant_rate_limits").delete().eq("tenant_id", tenant.id);
    expect(removed.error?.code).toBe("42501");
    const { rows } = await db.query("SELECT max_tokens FROM public.tenant_rate_limits WHERE tenant_id = $1", [tenant.id]);
    expect(rows).toEqual([{ max_tokens: 50 }]);
  });
});

describe("login Server Action (D28)", () => {
  it("refuses the sixth attempt on one account, even with the right password", async () => {
    const email = tenant.manager.email;
    for (let i = 0; i < 5; i++) {
      await expect(signIn({ email, password: "wrong-password" })).resolves.toEqual({ error: WRONG });
    }
    const sixth = await signIn({ email, password });
    expect(sixth.error).toMatch(LIMITED);
    expect([...request.cookies.keys()].some((name) => name.includes("auth-token"))).toBe(false);
  });

  it("limits one client IP across accounts", async () => {
    for (let i = 0; i < 20; i++) {
      await expect(signIn({ email: `nobody-${randomUUID()}@example.test`, password: "x" })).resolves.toEqual({ error: WRONG });
    }
    const next = await signIn({ email: tenant.employee.email, password });
    expect(next.error).toMatch(LIMITED);
  });

  it("fails closed when the limiter cannot answer", async () => {
    await db.query("REVOKE EXECUTE ON FUNCTION public.rate_limit_consume(text, text, integer, integer, uuid) FROM prisma_app");
    try {
      const result = await signIn({ email: tenant.employee.email, password });
      expect(result.error).toBe("No se pudo procesar la solicitud. Intenta de nuevo en 30 segundos.");
    } finally {
      await db.query("GRANT EXECUTE ON FUNCTION public.rate_limit_consume(text, text, integer, integer, uuid) TO prisma_app");
    }
  });

  it("signs in on the server, sets the session cookie and audits the login there", async () => {
    const logins = async () =>
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1 AND user_id = $2 AND action = 'AUTH_LOGIN'",
          [tenant.id, tenant.employee.userId],
        )
      ).rows[0].n;
    const before = await logins();
    await expect(signIn({ email: tenant.employee.email, password })).resolves.toEqual({});
    expect([...request.cookies.keys()].some((name) => name.includes("auth-token"))).toBe(true);
    expect(await logins()).toBe(before + 1);
  });

  it("stores no email or IP in the buckets", async () => {
    const { rows } = await db.query("SELECT 1 FROM public.rate_limits WHERE key LIKE '%@%' OR key LIKE '%198.51.100.%'");
    expect(rows).toEqual([]);
  });
});

describe("MFA Server Action (D28)", () => {
  async function signedInWithFactor(user: { email: string }) {
    await expect(signIn({ email: user.email, password })).resolves.toEqual({});
    const client = createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await client.auth.signInWithPassword({ email: user.email, password });
    const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `d28-${randomUUID()}` });
    expect(error).toBeNull();
    return { factorId: data!.id, secret: data!.totp.secret };
  }

  it("refuses the sixth code, even a valid one", async () => {
    const { factorId, secret } = await signedInWithFactor(other.employee);
    for (let i = 0; i < 5; i++) {
      await expect(verifyMfa({ factorId, code: "000000" })).resolves.toEqual({ error: "El código no es válido o ya venció." });
    }
    const sixth = await verifyMfa({ factorId, code: generateSync({ secret }) });
    expect(sixth.error).toMatch(LIMITED);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1 AND user_id = $2 AND action = 'MFA_VERIFY_FAILED'",
      [other.id, other.employee.userId],
    );
    expect(rows[0].n).toBe(5);
  });

  it("verifies a valid code on the server and audits it", async () => {
    const { factorId, secret } = await signedInWithFactor(other.manager);
    await expect(verifyMfa({ factorId, code: generateSync({ secret }) })).resolves.toEqual({});
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM public.audit_logs WHERE tenant_id = $1 AND user_id = $2 AND action = 'MFA_VERIFY'",
      [other.id, other.manager.userId],
    );
    expect(rows[0].n).toBe(1);
  });
});
