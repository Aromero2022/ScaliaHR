import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { contentSecurityPolicy, createNonce } from "@/lib/security/csp";

const auth = { getUser: vi.fn(), getClaims: vi.fn(), mfa: { getAuthenticatorAssuranceLevel: vi.fn() } };
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(() => ({ auth })) }));

import { middleware } from "@/middleware";

/** One directive of a policy, e.g. "script-src ...". */
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `));

describe("contentSecurityPolicy (D29)", () => {
  it("lets scripts run only with the nonce, with no unsafe-inline or unsafe-eval", () => {
    const script = directive(contentSecurityPolicy("abc123", { dev: false }), "script-src");
    expect(script).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it("adds unsafe-eval only for next dev", () => {
    expect(directive(contentSecurityPolicy("n", { dev: true }), "script-src")).toContain("'unsafe-eval'");
  });

  it("keeps the rest of the policy", () => {
    const csp = contentSecurityPolicy("n", { dev: false, supabaseUrl: "https://abcdefghij.supabase.co" });
    for (const part of [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ]) {
      expect(csp.split("; ")).toContain(part);
    }
  });

  it("allows the configured local Supabase origin and nothing broader", () => {
    const csp = contentSecurityPolicy("n", { dev: false, supabaseUrl: "http://localhost:54321" });
    expect(directive(csp, "connect-src")).toBe(
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co http://localhost:54321 ws://localhost:54321",
    );
  });

  it("makes a new 128-bit nonce each time", () => {
    const a = createNonce();
    expect(atob(a)).toHaveLength(16);
    expect(createNonce()).not.toBe(a);
  });
});

describe("middleware CSP (D29)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    auth.getClaims.mockResolvedValue({ data: null, error: null });
  });

  async function visit(path: string) {
    return middleware(new NextRequest(`http://localhost:3000${path}`, { headers: { host: "localhost:3000", "x-nonce": "spoofed" } }));
  }

  it("sends a policy with a fresh nonce and forwards the same nonce to the page", async () => {
    const res = await visit("/login");
    const csp = res.headers.get("content-security-policy")!;
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "script-src")).not.toContain("unsafe-inline");

    const again = (await visit("/login")).headers.get("content-security-policy")!;
    expect(again).not.toBe(csp);
  });

  it("sets it on redirects too", async () => {
    const res = await visit("/dashboard");
    expect(res.status).toBe(307);
    expect(res.headers.get("content-security-policy")).toMatch(/'nonce-[^']+'/);
  });
});
