import { describe, it, expect, beforeAll, vi } from "vitest";
import nextConfig from "../../next.config";

type HeaderEntry = { key: string; value: string };

async function getConfiguredHeaders(): Promise<HeaderEntry[]> {
  if (!nextConfig.headers) return [];
  const headerGroups = await nextConfig.headers();
  const catchAll = headerGroups.find((g) => g.source === "/(.*)");
  return (catchAll?.headers ?? []) as HeaderEntry[];
}

describe("Security headers in next.config", () => {
  let headers: HeaderEntry[];

  beforeAll(async () => {
    headers = await getConfiguredHeaders();
  });

  it("sets Content-Security-Policy", () => {
    const csp = headers.find((h) => h.key === "Content-Security-Policy");
    expect(csp).toBeDefined();
    expect(csp!.value).toContain("default-src 'self'");
    expect(csp!.value).toContain("frame-ancestors 'none'");
    expect(csp!.value).toContain("object-src 'none'");
  });

  it("sets Strict-Transport-Security with long max-age", () => {
    const hsts = headers.find(
      (h) => h.key === "Strict-Transport-Security"
    );
    expect(hsts).toBeDefined();
    expect(hsts!.value).toContain("max-age=63072000");
    expect(hsts!.value).toContain("includeSubDomains");
    expect(hsts!.value).toContain("preload");
  });

  it("sets X-Frame-Options to DENY", () => {
    const xfo = headers.find((h) => h.key === "X-Frame-Options");
    expect(xfo).toBeDefined();
    expect(xfo!.value).toBe("DENY");
  });

  it("sets X-Content-Type-Options to nosniff", () => {
    const xcto = headers.find((h) => h.key === "X-Content-Type-Options");
    expect(xcto).toBeDefined();
    expect(xcto!.value).toBe("nosniff");
  });

  it("sets Referrer-Policy to strict-origin-when-cross-origin", () => {
    const rp = headers.find((h) => h.key === "Referrer-Policy");
    expect(rp).toBeDefined();
    expect(rp!.value).toBe("strict-origin-when-cross-origin");
  });

  it("sets restrictive Permissions-Policy", () => {
    const pp = headers.find((h) => h.key === "Permissions-Policy");
    expect(pp).toBeDefined();
    expect(pp!.value).toContain("camera=()");
    expect(pp!.value).toContain("microphone=()");
    expect(pp!.value).toContain("geolocation=()");
    expect(pp!.value).toContain("payment=()");
  });

  it("CSP restricts connect-src to self and supabase", () => {
    const csp = headers.find((h) => h.key === "Content-Security-Policy");
    expect(csp!.value).toContain(
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co"
    );
  });

  it("CSP allows the configured local Supabase origin and nothing broader", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.resetModules();
    const { default: config } = await import("../../next.config");
    const groups = await config.headers!();
    const value = groups[0].headers.find((h) => h.key === "Content-Security-Policy")!.value;
    vi.unstubAllEnvs();

    const connect = value.split("; ").find((d) => d.startsWith("connect-src"));
    expect(connect).toBe(
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co http://localhost:54321 ws://localhost:54321",
    );
  });

  it("CSP adds nothing for hosted *.supabase.co projects", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghij.supabase.co");
    vi.resetModules();
    const { default: config } = await import("../../next.config");
    const groups = await config.headers!();
    const value = groups[0].headers.find((h) => h.key === "Content-Security-Policy")!.value;
    vi.unstubAllEnvs();

    expect(value).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co;");
  });

  it("CSP allows fonts from Google", () => {
    const csp = headers.find((h) => h.key === "Content-Security-Policy");
    expect(csp!.value).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(csp!.value).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
  });
});
