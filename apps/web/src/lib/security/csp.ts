// D29 — Content-Security-Policy with a fresh nonce per request, set by the
// middleware. Scripts run only with that nonce ('strict-dynamic' lets them load
// the chunks they import); no 'unsafe-inline' and, outside `next dev`, no
// 'unsafe-eval'. Runs on the Edge runtime (middleware): Web Crypto only.

/** Request header the middleware forwards the nonce in, for server components that need it. */
export const NONCE_HEADER = "x-nonce";

export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

// The browser talks to Supabase directly, so the configured project (local
// Supabase included) must be reachable besides hosted *.supabase.co projects.
function supabaseConnectSources(url: string | undefined): string[] {
  if (!url) return [];
  const { origin, hostname } = new URL(url);
  if (hostname.endsWith(".supabase.co")) return [];
  return [origin, origin.replace(/^http/, "ws")];
}

export interface CspOptions {
  /** `next dev` needs 'unsafe-eval' (React's development build evaluates code). */
  dev?: boolean;
  supabaseUrl?: string;
}

export function contentSecurityPolicy(nonce: string, options: CspOptions = {}): string {
  const dev = options.dev ?? process.env.NODE_ENV === "development";
  const supabaseUrl = options.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  return [
    "default-src 'self'",
    ["script-src 'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])].join(" "),
    // Styles keep 'unsafe-inline': React and Next.js write inline style attributes.
    // Fonts are self-hosted with next/font (D40): no font or style host outside 'self'.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    ["connect-src 'self' https://*.supabase.co wss://*.supabase.co", ...supabaseConnectSources(supabaseUrl)].join(" "),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
