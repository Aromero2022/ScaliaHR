import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D38: the colleague search behind the feedback and ARCO forms; a POST with a
 * JSON body since 9c PR 6c, from a page of the same host (Origin) and as JSON
 * (Content-Type), both checked after the limiter and the session.
 */

const limitApi = vi.fn(async () => null as Response | null);
vi.mock("@/lib/rate-limit", () => ({ limitApi: () => limitApi() }));
const getCurrentUser = vi.fn();
const { CurrentUserUnavailable } = vi.hoisted(() => ({
  CurrentUserUnavailable: class extends Error {
    constructor(readonly userMessage: string) {
      super("unavailable");
    }
  },
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: () => getCurrentUser(), CurrentUserUnavailable }));
const reportError = vi.fn();
vi.mock("@/lib/log/report", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));
vi.mock("@/lib/log/request-context", () => ({ requestContext: async () => ({ requestId: "req-6c" }) }));

const calls: [string, ...unknown[]][] = [];
let answer: { data: unknown; error: unknown } = { data: [], error: null };
function chain(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "or", "order", "limit", "neq"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  return builder;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => chain() }) }));

import { GET, POST } from "@/app/api/colleagues/route";

const me = { id: "me-1", tenant_id: "t-1", position_id: null };
// What a browser sends from a page of acme-corp.localhost:3000.
const SAME_HOST = { Host: "acme-corp.localhost:3000", Origin: "http://acme-corp.localhost:3000", "Content-Type": "application/json" };
const post = (body: unknown, headers: Record<string, string | undefined> = {}) => {
  const sent = Object.fromEntries(Object.entries({ ...SAME_HOST, ...headers }).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return POST(
    new Request("http://acme-corp.localhost:3000/api/colleagues", { method: "POST", headers: sent, body: typeof body === "string" ? body : JSON.stringify(body) }),
  );
};
const called = (method: string) => calls.filter(([m]) => m === method).map(([, ...args]) => args);
const SAFE_403 = "No se pudo completar la operación. Intenta de nuevo. Código: req-6c";

beforeEach(() => {
  calls.length = 0;
  answer = { data: [{ id: "u2", first_name: "Ana", last_name: "Ruiz", email: "ana@x.dev" }], error: null };
  limitApi.mockResolvedValue(null);
  getCurrentUser.mockResolvedValue(me);
  reportError.mockClear();
});

describe("POST /api/colleagues (D38, 9c PR 6c)", () => {
  it("answers 405 to a GET, so the search never travels in a URL", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
    expect(calls).toEqual([]);
    limitApi.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await GET()).status).toBe(429);
  });

  it("returns at most 20 active people of the caller's tenant, without the caller", async () => {
    const res = await post({ q: "ana" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ colleagues: answer.data });
    expect(called("eq")).toEqual([["tenant_id", "t-1"], ["status", "ACTIVE"]]);
    expect(called("is")).toEqual([["deleted_at", null]]);
    expect(called("limit")).toEqual([[20]]);
    expect(called("neq")).toEqual([["id", "me-1"]]);
  });

  it("can include the caller (ARCO) and quotes the search text in the or() filter", async () => {
    await post({ q: "a,id.eq.1)(", self: true });
    expect(called("neq")).toEqual([]);
    expect(called("or")).toEqual([['first_name.ilike."%a,id.eq.1)(%",last_name.ilike."%a,id.eq.1)(%",email.ilike."%a,id.eq.1)(%"']]);
  });

  it("accepts application/json with a charset", async () => {
    expect((await post({ q: "ana" }, { "Content-Type": "application/json; charset=utf-8" })).status).toBe(200);
  });

  it.each([["text/plain", "text/plain"], ["a form", "application/x-www-form-urlencoded"], ["no Content-Type", undefined]] as const)(
    "answers 415 to %s without querying",
    async (_, type) => {
      const res = await post({ q: "ana" }, { "Content-Type": type });
      expect(res.status).toBe(415);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(calls).toEqual([]);
    },
  );

  it.each([["another site's Origin", "https://evil.example"], ["another tenant's subdomain", "http://other.localhost:3000"], ["another port", "http://acme-corp.localhost:4000"], ['Origin "null"', "null"], ["no Origin", undefined]] as const)(
    "answers 403 with the safe message and the request id to %s, without querying",
    async (_, origin) => {
      const res = await post({ q: "ana" }, { Origin: origin });
      expect(res.status).toBe(403);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      await expect(res.json()).resolves.toEqual({ error: SAFE_403 });
      expect(reportError).toHaveBeenCalledWith("colleagues.origin", expect.any(Error), { requestId: "req-6c" });
      expect(calls).toEqual([]);
    },
  );

  it.each([["no body", ""], ["not JSON", "q=ana"], ["one letter", { q: "a" }], ["61 letters", { q: "x".repeat(61) }], ["self not a boolean", { q: "ana", self: "1" }], ["q not a string", { q: ["ana"] }]] as const)(
    "answers 400 with an empty list to %s without querying",
    async (_, body) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      await expect(res.json()).resolves.toEqual({ colleagues: [] });
      expect(calls).toEqual([]);
    },
  );

  it("checks the limiter and the session before the Content-Type, the Origin and the body", async () => {
    const bad = { "Content-Type": "text/plain", Origin: "https://evil.example" };
    limitApi.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await post("x", bad)).status).toBe(429);
    getCurrentUser.mockResolvedValueOnce(null);
    expect((await post("x", bad)).status).toBe(401);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("needs a session and a token from the limiter", async () => {
    getCurrentUser.mockResolvedValueOnce(null);
    expect((await post({ q: "ana" })).status).toBe(401);
    limitApi.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await post({ q: "ana" })).status).toBe(429);
  });

  it("D45: answers 500 unavailable, not 401, when the caller's employee row cannot be read", async () => {
    getCurrentUser.mockRejectedValueOnce(new CurrentUserUnavailable("No se pudo cargar esta página. Código: req-1"));
    const res = await post({ q: "ana" });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "unavailable" });
    expect(calls).toEqual([]);
  });

  it("hides database errors", async () => {
    answer = { data: null, error: { message: "boom" } };
    const res = await post({ q: "ana" });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "unavailable" });
  });
});
