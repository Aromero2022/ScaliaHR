import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseServerTarget } from "@/lib/supabase/server-url";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

/**
 * D27 — a forced error end to end: the real middleware gives a real session's
 * request its id and the tenant of its verified token, a real database error
 * that quotes an RFC goes through safeError(), and the JSON log line carries
 * both ids with the RFC masked while the user only sees a generic message.
 */

const forwardedHeaders = new Map<string, string>();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => forwardedHeaders) }));

const env = integrationEnv();
process.env.NEXT_PUBLIC_SUPABASE_URL = env.supabaseUrl;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.anonKey;
process.env.APP_BASE_URL = "http://localhost:3000";
delete process.env.SUPABASE_INTERNAL_URL;

const { middleware } = await import("@/middleware");
const { safeError, GENERIC_ERROR } = await import("@/lib/errors/safe-error");

const db = new pg.Client({ connectionString: env.dbUrl });
const app = new pg.Client({ connectionString: env.prismaDbUrl });
await db.connect();
await app.connect();
const world = new TestWorld(env, db);
let tenant: TestTenant;
let cookie = "";

beforeAll(async () => {
  tenant = await world.createTenant();
  const jar = new Map<string, string>();
  const target = supabaseServerTarget();
  const client = createServerClient(target.url, env.anonKey, {
    cookieOptions: { name: target.cookieName },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  await client.auth.setSession(await world.session(tenant.employee.email));
  cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await app.end();
    await db.end();
  }
});

describe("a forced error in the JSON logs (D27)", () => {
  it("carries the request id and the tenant id, masks the RFC and shows the user a generic message", async () => {
    const res = await middleware(
      new NextRequest("http://localhost:3000/dashboard", {
        headers: { host: "localhost:3000", cookie, "x-tenant-id": "spoofed", "x-request-id": "spoofed" },
      }),
    );
    expect(res.status).toBe(200);
    const requestId = res.headers.get("x-request-id")!;
    forwardedHeaders.set("x-request-id", res.headers.get("x-middleware-request-x-request-id")!);
    forwardedHeaders.set("x-tenant-id", res.headers.get("x-middleware-request-x-tenant-id")!);

    const dbError = await app.query("SELECT 'GODE561231GR8'::int").catch((error: unknown) => error);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = await safeError("it.forced_error", dbError);
    const line = JSON.parse(String(err.mock.calls.at(-1)?.[0]));
    err.mockRestore();

    expect(message).toBe(`${GENERIC_ERROR} Código: ${requestId}`);
    expect(line).toMatchObject({
      level: "error",
      event: "it.forced_error",
      requestId,
      tenantId: tenant.id,
      error: { code: "22P02", message: 'invalid input syntax for type integer: "[RFC]"' },
    });
    expect(JSON.stringify(line)).not.toContain("GODE561231GR8");
  });
});
