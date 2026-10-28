import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/tenant/get-module-flags", () => ({
  getModuleFlags: vi.fn(),
}));

vi.mock("@/lib/lms/moodle-client", () => ({
  getUser: vi.fn(),
  createUser: vi.fn(),
  addCohortMembers: vi.fn(),
  requestLoginUrl: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import * as moodleClient from "@/lib/lms/moodle-client";
import { GET } from "@/app/(protected)/lms/launch/route";
import { NextRequest } from "next/server";
import { toModuleFlags } from "@/lib/tenant/module-flags";

const mockGetModuleFlags = vi.mocked(getModuleFlags);
const mockMoodle = vi.mocked(moodleClient);

function makeRequest(url = "http://localhost:3000/lms/launch"): NextRequest {
  return new NextRequest(url);
}

type FakeUser = {
  id: string;
  email: string;
  tenant_id?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
};

// The route reads the verified JWT claims: sub, email, user_metadata and the
// root tenant_id claim written by custom_access_token_hook.
function mockSupabaseUser(user: FakeUser | null) {
  const claims = user && {
    sub: user.id,
    email: user.email,
    tenant_id: user.tenant_id,
    app_metadata: user.app_metadata ?? {},
    user_metadata: user.user_metadata,
  };
  const supabase = {
    auth: { getClaims: vi.fn().mockResolvedValue({ data: claims && { claims }, error: null }) },
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.single = vi.fn().mockResolvedValue({ data: { moodle_cohort_id: 201 }, error: null });
      return chain;
    }),
  };
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
  return supabase;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /lms/launch", () => {
  it("redirects to /login when there is no session", async () => {
    mockSupabaseUser(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("returns 404 when is_lms_active is false", async () => {
    mockSupabaseUser({
      id: "user-1",
      email: "test@acme.dev",
      tenant_id: "tenant-1",
      user_metadata: {},
    });
    mockGetModuleFlags.mockResolvedValue(toModuleFlags({ is_lms_active: false }));

    const res = await GET(makeRequest());

    expect(res.status).toBe(404);
  });

  it("redirects to Moodle login URL with valid session and LMS flag", async () => {
    mockSupabaseUser({
      id: "user-1",
      email: "elena@acme.dev",
      tenant_id: "tenant-1",
      user_metadata: { first_name: "Elena", last_name: "Martinez" },
    });
    mockGetModuleFlags.mockResolvedValue(toModuleFlags({ is_lms_active: true }));
    mockMoodle.getUser.mockResolvedValue({ id: 501, username: "user-1", email: "elena@acme.dev" });
    mockMoodle.requestLoginUrl.mockResolvedValue(
      "https://moodle.local/auth/userkey/login.php?key=abc123"
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("moodle.local/auth/userkey/login.php");
    expect(mockMoodle.requestLoginUrl).toHaveBeenCalledWith("user-1");
  });

  it("provisions new Moodle user if not found", async () => {
    mockSupabaseUser({
      id: "user-2",
      email: "carlos@acme.dev",
      tenant_id: "tenant-1",
      user_metadata: { first_name: "Carlos", last_name: "Lopez" },
    });
    mockGetModuleFlags.mockResolvedValue(toModuleFlags({ is_lms_active: true }));
    mockMoodle.getUser.mockResolvedValue(null);
    mockMoodle.createUser.mockResolvedValue({ id: 502, username: "user-2", email: "carlos@acme.dev" });
    mockMoodle.requestLoginUrl.mockResolvedValue("https://moodle.local/auth/userkey/login.php?key=xyz");

    const res = await GET(makeRequest());

    expect(res.status).toBe(307);
    expect(mockMoodle.createUser).toHaveBeenCalledWith({
      username: "user-2",
      email: "carlos@acme.dev",
      firstName: "Carlos",
      lastName: "Lopez",
    });
    expect(mockMoodle.addCohortMembers).toHaveBeenCalledWith(201, [502]);
  });

  it("returns 403 when user has no tenant", async () => {
    mockSupabaseUser({
      id: "user-3",
      email: "orphan@test.dev",
      user_metadata: {},
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
  });

  it("ignores tenant_id in app_metadata: only the root claim counts", async () => {
    mockSupabaseUser({
      id: "user-4",
      email: "meta@test.dev",
      app_metadata: { tenant_id: "tenant-1" },
      user_metadata: {},
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    expect(mockGetModuleFlags).not.toHaveBeenCalled();
  });
});
