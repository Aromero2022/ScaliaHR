import { beforeEach, describe, expect, it, vi } from "vitest";

/** D38: the colleague search behind the feedback and ARCO forms; a POST with a JSON body since 9c PR 6c. */

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
vi.mock("@/lib/log/report", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/log/request-context", () => ({ requestContext: async () => ({}) }));

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

import * as route from "@/app/api/colleagues/route";
import { POST } from "@/app/api/colleagues/route";

const me = { id: "me-1", tenant_id: "t-1", position_id: null };
const post = (body: unknown) =>
  POST(new Request("http://localhost:3000/api/colleagues", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const called = (method: string) => calls.filter(([m]) => m === method).map(([, ...args]) => args);

beforeEach(() => {
  calls.length = 0;
  answer = { data: [{ id: "u2", first_name: "Ana", last_name: "Ruiz", email: "ana@x.dev" }], error: null };
  limitApi.mockResolvedValue(null);
  getCurrentUser.mockResolvedValue(me);
});

describe("POST /api/colleagues (D38, 9c PR 6c)", () => {
  it("has no GET: the search never travels in a URL", () => {
    expect(Object.keys(route)).not.toContain("GET");
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

  it.each([["no body", ""], ["not JSON", "q=ana"], ["one letter", { q: "a" }], ["61 letters", { q: "x".repeat(61) }], ["self not a boolean", { q: "ana", self: "1" }], ["q not a string", { q: ["ana"] }]] as const)(
    "answers an empty list to %s without querying",
    async (_, body) => {
      await expect((await post(body)).json()).resolves.toEqual({ colleagues: [] });
      expect(calls).toEqual([]);
    },
  );

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
