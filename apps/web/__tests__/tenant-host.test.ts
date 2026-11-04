import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTenantHost, requestedTenant, tenantAccessAllowed, tenantNotFound } from "@/lib/tenant/host";

describe("requestedTenant (D21)", () => {
  it.each([
    ["acme-corp.localhost:3000", undefined, "acme-corp"],
    ["ACME-Corp.LOCALHOST:3000", undefined, "acme-corp"],
    ["acme-corp.localhost", "other", "acme-corp"],
    ["a.b.localhost:3000", undefined, "a.b"],
    ["localhost:3000", "acme-corp", "acme-corp"],
    ["localhost:3000", undefined, null],
    ["127.0.0.1:3000", "acme-corp", null],
    ["evil.example", "acme-corp", null],
    ["localhost.evil.example", undefined, null],
    [null, "acme-corp", null],
  ])("host %s with company code %s asks for %s", (host, code, expected) => {
    expect(requestedTenant(host, code, "localhost")).toBe(expected);
  });

  it("knows tenant subdomains from the app host", () => {
    expect(isTenantHost("acme-corp.localhost:3000", "localhost")).toBe(true);
    expect(isTenantHost("localhost:3000", "localhost")).toBe(false);
    expect(isTenantHost("localhost.evil.example", "localhost")).toBe(false);
  });
});

function fakeSupabase(row: unknown, error: unknown = null) {
  const eq = vi.fn(() => ({ maybeSingle: async () => ({ data: row, error }) }));
  const client = { from: vi.fn(() => ({ select: () => ({ eq }) })) };
  return { client: client as unknown as SupabaseClient, eq, from: client.from };
}

describe("tenantAccessAllowed (D21)", () => {
  it("allows a request without tenant for a user without tenant, without a lookup", async () => {
    const { client, from } = fakeSupabase(null);
    await expect(tenantAccessAllowed(client, null, "")).resolves.toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses a malformed slug without a lookup", async () => {
    const { client, from } = fakeSupabase({ id: "t1", suspended_at: null });
    await expect(tenantAccessAllowed(client, "a.b", "t1")).resolves.toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ["the token's own active tenant", { id: "t1", suspended_at: null }, null, true],
    ["another tenant", { id: "t2", suspended_at: null }, null, false],
    ["a suspended tenant", { id: "t1", suspended_at: "2026-11-04T00:00:00Z" }, null, false],
    ["no visible tenant", null, null, false],
    ["a failed lookup", null, { message: "down" }, false],
  ])("for %s returns %s", async (_label, row, error, expected) => {
    const { client } = fakeSupabase(row, error);
    await expect(tenantAccessAllowed(client, "acme-corp", "t1")).resolves.toBe(expected);
  });
});

describe("tenantNotFound (D21)", () => {
  it("is a 404 that names no tenant and is never cached", async () => {
    const res = tenantNotFound();
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).not.toMatch(/suspend|tenant|empresa/i);
  });
});
