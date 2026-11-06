import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** D38: the colleague search behind the feedback and ARCO forms. */

const limitApi = vi.fn(async () => null as Response | null);
vi.mock("@/lib/rate-limit", () => ({ limitApi: () => limitApi() }));
const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: () => getCurrentUser() }));
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

import { GET } from "@/app/api/colleagues/route";

const me = { id: "me-1", tenant_id: "t-1", position_id: null };
const get = (query: string) => GET(new NextRequest(`http://localhost:3000/api/colleagues${query}`));
const called = (method: string) => calls.filter(([m]) => m === method).map(([, ...args]) => args);

beforeEach(() => {
  calls.length = 0;
  answer = { data: [{ id: "u2", first_name: "Ana", last_name: "Ruiz", email: "ana@x.dev" }], error: null };
  limitApi.mockResolvedValue(null);
  getCurrentUser.mockResolvedValue(me);
});

describe("GET /api/colleagues (D38)", () => {
  it("returns at most 20 active people of the caller's tenant, without the caller", async () => {
    const res = await get("?q=ana");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ colleagues: answer.data });
    expect(called("eq")).toEqual([["tenant_id", "t-1"], ["status", "ACTIVE"]]);
    expect(called("is")).toEqual([["deleted_at", null]]);
    expect(called("limit")).toEqual([[20]]);
    expect(called("neq")).toEqual([["id", "me-1"]]);
  });

  it("can include the caller (ARCO) and quotes the search text in the or() filter", async () => {
    await get("?q=a,id.eq.1)(&self=1");
    expect(called("neq")).toEqual([]);
    expect(called("or")).toEqual([['first_name.ilike."%a,id.eq.1)(%",last_name.ilike."%a,id.eq.1)(%",email.ilike."%a,id.eq.1)(%"']]);
  });

  it.each(["", "?q=a", `?q=${"x".repeat(61)}`, "?q=ana&self=yes"])("answers an empty list to %s without querying", async (query) => {
    await expect((await get(query)).json()).resolves.toEqual({ colleagues: [] });
    expect(calls).toEqual([]);
  });

  it("needs a session and a token from the limiter", async () => {
    getCurrentUser.mockResolvedValueOnce(null);
    expect((await get("?q=ana")).status).toBe(401);
    limitApi.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await get("?q=ana")).status).toBe(429);
  });

  it("hides database errors", async () => {
    answer = { data: null, error: { message: "boom" } };
    const res = await get("?q=ana");
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "unavailable" });
  });
});
