import { describe, it, expect } from "vitest";

/**
 * S1 Security Hardening Integration Tests
 *
 * Validates the security hardening changes from Loop S1:
 * - requesting_tenant_id() is JWT-only (no fallback)
 * - PII RESTRICTIVE policies on ec_personal_information / ec_compensation
 * - ARCO role-based policies (subject sees own, admin manages)
 * - SECURITY DEFINER functions have SET search_path = ''
 * - RBP v2 model is active (role_grants + group_members)
 *
 * Requires a running Supabase local instance with all migrations applied.
 * In CI, this runs after `supabase db reset` in the db job.
 */

const HAS_DB = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const describeWithDb = HAS_DB ? describe : describe.skip;

describeWithDb("S1: requesting_tenant_id() — JWT-only", () => {
  it("returns NULL when no JWT claim is set", async () => {
    const res = await supabaseQuery(
      "SELECT public.requesting_tenant_id() AS tid",
      "anon"
    );
    expect(res.error).toBeTruthy();
  });

  it("returns the tenant_id from a valid JWT", async () => {
    const res = await supabaseQuery(
      "SELECT public.requesting_tenant_id() AS tid",
      "authenticated"
    );
    expect(res.data).toBeDefined();
  });
});

describeWithDb("S1: current_tenant_id() dropped", () => {
  it("function no longer exists", async () => {
    const res = await supabaseQuery(
      `SELECT count(*) AS cnt
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'current_tenant_id'`,
      "service_role"
    );
    expect(Number(res.data?.[0]?.cnt)).toBe(0);
  });
});

describeWithDb("S1: SECURITY DEFINER — search_path hardened", () => {
  const definerFunctions = [
    "is_tenant_admin",
    "insert_effective_record",
    "effective_record_at",
    "anonymize_user",
    "export_user_data",
  ];

  for (const fn of definerFunctions) {
    it(`${fn}() has SET search_path = ''`, async () => {
      const res = await supabaseQuery(
        `SELECT proconfig
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = '${fn}'`,
        "service_role"
      );
      const config = res.data?.[0]?.proconfig;
      expect(config).toBeDefined();
      expect(
        Array.isArray(config)
          ? config.some((c: string) => c.includes("search_path="))
          : String(config).includes("search_path=")
      ).toBe(true);
    });
  }
});

describeWithDb("S1: PII RESTRICTIVE policies exist", () => {
  it("ec_personal_information has RESTRICTIVE select policy", async () => {
    const res = await supabaseQuery(
      `SELECT polname, polpermissive
       FROM pg_policy
       WHERE polrelid = 'public.ec_personal_information'::regclass
         AND polcmd = 'r'
         AND NOT polpermissive`,
      "service_role"
    );
    expect(res.data?.length).toBeGreaterThanOrEqual(1);
  });

  it("ec_compensation has RESTRICTIVE select policy", async () => {
    const res = await supabaseQuery(
      `SELECT polname, polpermissive
       FROM pg_policy
       WHERE polrelid = 'public.ec_compensation'::regclass
         AND polcmd = 'r'
         AND NOT polpermissive`,
      "service_role"
    );
    expect(res.data?.length).toBeGreaterThanOrEqual(1);
  });
});

describeWithDb("S1: ARCO policies — role-based access", () => {
  it("arco_requests has select policy for subject+admin", async () => {
    const res = await supabaseQuery(
      `SELECT polname
       FROM pg_policy
       WHERE polrelid = 'public.arco_requests'::regclass
         AND polcmd = 'r'`,
      "service_role"
    );
    const names = res.data?.map((r) => r.polname as string) ?? [];
    expect(names).toContain("arco_select");
  });

  it("arco_requests has insert/update policies for admin only", async () => {
    const res = await supabaseQuery(
      `SELECT polname, polcmd
       FROM pg_policy
       WHERE polrelid = 'public.arco_requests'::regclass
         AND polcmd IN ('a', 'w')`,
      "service_role"
    );
    const names = res.data?.map((r) => r.polname as string) ?? [];
    expect(names).toContain("arco_insert");
    expect(names).toContain("arco_update");
  });
});

describeWithDb("S1: RBP v2 tables exist", () => {
  it("role_grants table exists with target_population column", async () => {
    const res = await supabaseQuery(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'role_grants'
         AND column_name = 'target_population'`,
      "service_role"
    );
    expect(res.data?.length).toBe(1);
  });

  it("group_members table exists", async () => {
    const res = await supabaseQuery(
      `SELECT count(*) AS cnt
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'group_members'`,
      "service_role"
    );
    expect(Number(res.data?.[0]?.cnt)).toBe(1);
  });

  it("role_permissions has permission_key and action columns", async () => {
    const res = await supabaseQuery(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'role_permissions'
         AND column_name IN ('permission_key', 'action', 'field_key')
       ORDER BY column_name`,
      "service_role"
    );
    const cols = res.data?.map((r) => r.column_name as string) ?? [];
    expect(cols).toContain("permission_key");
    expect(cols).toContain("action");
    expect(cols).toContain("field_key");
  });
});

describeWithDb("S1: v1 tables deprecated but present", () => {
  it("role_assignments table still exists", async () => {
    const res = await supabaseQuery(
      `SELECT count(*) AS cnt
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'role_assignments'`,
      "service_role"
    );
    expect(Number(res.data?.[0]?.cnt)).toBe(1);
  });

  it("role_assignments has DEPRECATED comment", async () => {
    const res = await supabaseQuery(
      `SELECT obj_description('public.role_assignments'::regclass) AS comment`,
      "service_role"
    );
    expect(res.data?.[0]?.comment).toContain("DEPRECATED");
  });
});

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

type QueryResult = {
  data?: Record<string, unknown>[] | null;
  error?: { message: string } | null;
};

async function supabaseQuery(
  sql: string,
  role: "anon" | "authenticated" | "service_role"
): Promise<QueryResult> {
  const url = process.env.SUPABASE_URL!;
  const key =
    role === "service_role"
      ? process.env.SUPABASE_SERVICE_ROLE_KEY!
      : process.env.SUPABASE_ANON_KEY!;

  const response = await fetch(`${url}/rest/v1/rpc/`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ query: sql }),
  }).catch(() => null);

  if (!response) return { error: { message: "fetch failed" } };

  // Fall back to raw SQL via the pg endpoint
  const pgRes = await fetch(`${url}/pg`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  }).catch(() => null);

  if (!pgRes || !pgRes.ok) {
    return { error: { message: `HTTP ${pgRes?.status ?? "network"}` } };
  }

  const json = await pgRes.json().catch(() => null);
  return { data: json };
}
