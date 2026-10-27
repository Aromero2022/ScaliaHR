const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_JWT_SECRET",
  "SUPABASE_TEST_DB_URL",
] as const;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export interface IntegrationEnv {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  jwtSecret: string;
  dbUrl: string;
}

export function integrationEnv(): IntegrationEnv {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    const where = process.env.CI ? "CI" : "this environment";
    throw new Error(
      `Integration tests cannot run in ${where}: missing ${missing.join(", ")}. ` +
        "Start the local stack (supabase start) and run scripts/run-integration-tests.sh, " +
        "which exports them from `supabase status`.",
    );
  }

  // These suites write fixtures; refuse anything that is not the local stack.
  for (const name of ["SUPABASE_URL", "SUPABASE_TEST_DB_URL"] as const) {
    const host = new URL(process.env[name]!).hostname;
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(`${name} must point to the local Supabase stack, got host "${host}"`);
    }
  }

  return {
    supabaseUrl: process.env.SUPABASE_URL!,
    anonKey: process.env.SUPABASE_ANON_KEY!,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    jwtSecret: process.env.SUPABASE_JWT_SECRET!,
    dbUrl: process.env.SUPABASE_TEST_DB_URL!,
  };
}
