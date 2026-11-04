import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/middleware", () => ({ updateSession: vi.fn() }));

import { config } from "@/middleware";

// Next.js compiles the matcher source as a regular expression anchored to the path.
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe("middleware matcher", () => {
  it("skips /api/health so healthchecks never need a session", () => {
    expect(matcher.test("/api/health")).toBe(false);
  });

  it("still runs on paths that only start like the health check", () => {
    expect(matcher.test("/api/healthz")).toBe(true);
    expect(matcher.test("/api/health/details")).toBe(true);
  });

  it("still runs on protected pages and other API routes", () => {
    expect(matcher.test("/dashboard")).toBe(true);
    expect(matcher.test("/admin-center")).toBe(true);
    expect(matcher.test("/api/lms/launch")).toBe(true);
  });
});
