import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { connection } from "next/server";
import { NONCE_HEADER } from "@/lib/security/csp";
import { DEFAULT_THEME_ATTRIBUTES, DEFAULT_THEME_CSS, THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

// D40: Inter (SIL OFL 1.1, src/fonts/inter/OFL.txt), served from the app's own
// origin; the CSP allows fonts from 'self' only.
const inter = localFont({
  src: "../fonts/inter/InterVariable-latin.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Scalia HR — Enterprise HCM",
  description: "SAP SuccessFactors-class Human Capital Management",
};

// D41: viewport-fit=cover lets the mobile dock pad itself with env(safe-area-inset-bottom).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // D29: every page renders per request, so Next.js can put the request's CSP
  // nonce on its scripts. A page prerendered at build time would carry none.
  await connection();
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    // The boot script may change data-theme and data-contrast before React
    // hydrates, so those attributes may differ from the server's.
    <html lang="es-MX" className={inter.variable} {...DEFAULT_THEME_ATTRIBUTES} suppressHydrationWarning>
      <head>
        {/* D40: a stored theme choice, applied before the first paint, with the CSP nonce (D29). */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: DEFAULT_THEME_CSS }} />
      </head>
      <body className="bg-canvas font-sans text-fg antialiased">{children}</body>
    </html>
  );
}
