import { describe, it, expect, beforeAll } from "vitest";
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

  it("leaves Content-Security-Policy to the middleware, which adds the nonce (D29)", () => {
    // Two policies would both apply; a static one without the nonce would block every script.
    expect(headers.find((h) => h.key === "Content-Security-Policy")).toBeUndefined();
  });

  it("builds no browser source maps (D29)", () => {
    expect(nextConfig.productionBrowserSourceMaps).toBe(false);
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
});
