import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { supabaseServerTarget } from "@/lib/supabase/server-url";

function browserStorageKey(url: string): string {
  const client = createClient(url, "anon", { auth: { persistSession: false } });
  return (client.auth as unknown as { storageKey: string }).storageKey;
}

afterEach(() => vi.unstubAllEnvs());

describe("supabaseServerTarget", () => {
  it("uses the public URL when no internal URL is set", () => {
    expect(supabaseServerTarget("http://localhost:54321", undefined).url).toBe("http://localhost:54321");
  });

  it("uses the internal URL on the server and keeps the browser's cookie name", () => {
    const target = supabaseServerTarget("http://localhost:54321", "http://kong:8000");
    expect(target.url).toBe("http://kong:8000");
    expect(target.cookieName).toBe(browserStorageKey("http://localhost:54321"));
    expect(target.cookieName).not.toBe(browserStorageKey("http://kong:8000"));
  });

  it("matches the supabase-js cookie name for hosted projects", () => {
    const url = "https://abcdefghij.supabase.co";
    expect(supabaseServerTarget(url, undefined).cookieName).toBe(browserStorageKey(url));
  });

  it("rejects an internal URL that is not http(s)", () => {
    expect(() => supabaseServerTarget("http://localhost:54321", "postgres://kong:8000")).toThrow();
  });

  it("reads both variables from the environment by default", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("SUPABASE_INTERNAL_URL", "http://kong:8000");
    expect(supabaseServerTarget()).toEqual({ url: "http://kong:8000", cookieName: "sb-localhost-auth-token" });
  });

  it("reads NEXT_PUBLIC_SUPABASE_URL literally so Next.js can inline it", () => {
    const source = readFileSync(path.resolve(__dirname, "../../src/lib/supabase/server-url.ts"), "utf-8");
    expect(source).toContain("= process.env.NEXT_PUBLIC_SUPABASE_URL");
  });
});
