import "server-only";

// D41 — the login page may show demo credentials only on a local stack. They
// are not in the code: the server variable SCALIA_DEMO_LOGIN_HINT carries the
// text, it is never a NEXT_PUBLIC_ variable (so it never reaches the client
// bundle), and a production server ignores it unless APP_BASE_URL is local.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function isLocalBaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return LOCAL_HOSTS.has(hostname) || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

type Env = Partial<Record<"SCALIA_DEMO_LOGIN_HINT" | "NODE_ENV" | "APP_BASE_URL", string>>;

/** The hint to show on /login, or null. */
export function demoLoginHint(env: Env = process.env as Env): string | null {
  const hint = env.SCALIA_DEMO_LOGIN_HINT?.trim();
  if (!hint) return null;
  if (env.NODE_ENV === "production" && !isLocalBaseUrl(env.APP_BASE_URL)) return null;
  return hint.slice(0, 200);
}
