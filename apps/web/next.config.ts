import path from "node:path";
import type { NextConfig } from "next";

// The browser talks to Supabase directly, so the configured project (local
// Supabase included) must be reachable besides hosted *.supabase.co projects.
function supabaseConnectSources(): string[] {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return [];
  const { origin, hostname } = new URL(url);
  if (hostname.endsWith(".supabase.co")) return [];
  return [origin, origin.replace(/^http/, "ws")];
}

const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  ["connect-src 'self' https://*.supabase.co wss://*.supabase.co", ...supabaseConnectSources()].join(" "),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@scaliahr/shared"],

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: cspDirectives,
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
