import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@scaliahr/shared", "@scaliahr/email"],
  // pg-boss stays a plain Node dependency of the server (lib/email, D20).
  serverExternalPackages: ["pg-boss"],
  // `next dev` on tenant subdomains such as acme-corp.localhost:3000 (D21).
  allowedDevOrigins: ["*.localhost"],
  // D29: no source maps in the browser build; stack traces stay on the server.
  productionBrowserSourceMaps: false,

  async headers() {
    return [
      {
        source: "/(.*)",
        // Content-Security-Policy comes from the middleware with a per-request nonce (D29).
        headers: [
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
