import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
const headerValues = new Map<string, string>();
const getClaims = vi.fn();

vi.mock("@/lib/db/tenant-client", () => ({ prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => ({ get: (name: string) => headerValues.get(name) ?? null })) }));
vi.mock("@/lib/supabase/claims", () => ({ getClaims: () => getClaims() }));

import {
  RATE_LIMITS,
  clientIp,
  consumeRateLimit,
  limitApi,
  limitWrite,
  rateLimitKey,
  rateLimitMessage,
  tooManyRequests,
} from "@/lib/rate-limit";

/** The values bound into the SQL call, in order: key, action, max, window, tenant. */
function lastCallValues(): unknown[] {
  const [, ...values] = queryRaw.mock.calls.at(-1)!;
  return values;
}

beforeEach(() => {
  vi.clearAllMocks();
  headerValues.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("consumeRateLimit (D28)", () => {
  it("allows when the database answers 0", async () => {
    queryRaw.mockResolvedValue([{ retry_after: 0 }]);
    await expect(consumeRateLimit("login", ["acme", "ana@acme.dev"])).resolves.toEqual({ allowed: true });
  });

  it("refuses with the seconds to wait", async () => {
    queryRaw.mockResolvedValue([{ retry_after: 42 }]);
    await expect(consumeRateLimit("login", ["acme", "ana@acme.dev"])).resolves.toEqual({
      allowed: false,
      retryAfter: 42,
      reason: "limited",
    });
  });

  it("sends a hashed key, the action's policy and the tenant", async () => {
    queryRaw.mockResolvedValue([{ retry_after: 0 }]);
    await consumeRateLimit("write", ["t1", "u1"], "t1");
    const [key, action, max, window, tenant] = lastCallValues();
    expect(key).toBe(rateLimitKey("write", ["t1", "u1"]));
    expect(key).toMatch(/^[\w-]{43}$/);
    expect([action, max, window, tenant]).toEqual(["write", RATE_LIMITS.write.maxTokens, RATE_LIMITS.write.windowSeconds, "t1"]);
  });

  it("never stores the email or IP in the key", async () => {
    const key = rateLimitKey("login", ["acme", "ana@acme.dev"]);
    expect(key).not.toContain("ana");
    expect(rateLimitKey("login", ["acme", "bob@acme.dev"])).not.toBe(key);
    expect(rateLimitKey("login_ip", ["acme", "ana@acme.dev"])).not.toBe(key);
  });

  it.each(["login_ip", "login", "mfa_verify", "tenant_create"] as const)("%s fails closed when the limiter is down", async (action) => {
    queryRaw.mockRejectedValue(new Error("connection refused"));
    await expect(consumeRateLimit(action, ["x"])).resolves.toEqual({ allowed: false, retryAfter: 30, reason: "unavailable" });
  });

  it.each(["write", "api"] as const)("%s fails open when the limiter is down", async (action) => {
    queryRaw.mockRejectedValue(new Error("connection refused"));
    await expect(consumeRateLimit(action, ["x"])).resolves.toEqual({ allowed: true });
  });
});

describe("clientIp", () => {
  it("takes the last X-Forwarded-For hop, the one the proxy wrote", async () => {
    headerValues.set("x-forwarded-for", "6.6.6.6, 10.0.0.1, 203.0.113.7");
    await expect(clientIp()).resolves.toBe("203.0.113.7");
  });

  it("falls back to X-Real-IP, then to a fixed value", async () => {
    headerValues.set("x-real-ip", "198.51.100.2");
    await expect(clientIp()).resolves.toBe("198.51.100.2");
    headerValues.clear();
    await expect(clientIp()).resolves.toBe("unknown");
  });
});

describe("answers", () => {
  it("say how long to wait, in minutes when it is long", () => {
    expect(rateLimitMessage({ allowed: false, retryAfter: 42, reason: "limited" })).toBe(
      "Demasiados intentos. Intenta de nuevo en 42 segundos.",
    );
    expect(rateLimitMessage({ allowed: false, retryAfter: 3600, reason: "limited" })).toBe(
      "Demasiados intentos. Intenta de nuevo en 60 minutos.",
    );
    expect(rateLimitMessage({ allowed: false, retryAfter: 30, reason: "unavailable" })).toMatch(/^No se pudo procesar/);
  });

  it("HTTP routes get 429 with Retry-After", async () => {
    const response = tooManyRequests({ allowed: false, retryAfter: 17, reason: "limited" });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    await expect(response.json()).resolves.toEqual({ error: "too_many_requests" });
  });
});

describe("limitWrite / limitApi", () => {
  it("use the signed-in user's bucket with their tenant's limit", async () => {
    getClaims.mockResolvedValue({ userId: "u1", tenantId: "t1" });
    queryRaw.mockResolvedValue([{ retry_after: 0 }]);
    await expect(limitWrite()).resolves.toBeNull();
    const [key, action, , , tenant] = lastCallValues();
    expect([key, action, tenant]).toEqual([rateLimitKey("write", ["t1", "u1"]), "write", "t1"]);
  });

  it("use the client IP before a session", async () => {
    getClaims.mockResolvedValue(null);
    headerValues.set("x-forwarded-for", "203.0.113.7");
    queryRaw.mockResolvedValue([{ retry_after: 0 }]);
    await limitApi();
    const [key, action, , , tenant] = lastCallValues();
    expect([key, action, tenant]).toEqual([rateLimitKey("api", ["ip", "203.0.113.7"]), "api", null]);
  });

  it("return the message or the 429 when refused", async () => {
    getClaims.mockResolvedValue({ userId: "u1", tenantId: "t1" });
    queryRaw.mockResolvedValue([{ retry_after: 5 }]);
    await expect(limitWrite()).resolves.toBe("Demasiados intentos. Intenta de nuevo en 5 segundos.");
    const response = await limitApi();
    expect(response?.status).toBe(429);
  });
});
