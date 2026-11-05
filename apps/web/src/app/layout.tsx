import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scalia HR — Enterprise HCM",
  description: "SAP SuccessFactors-class Human Capital Management",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // D29: every page renders per request, so Next.js can put the request's CSP
  // nonce on its scripts. A page prerendered at build time would carry none.
  await connection();
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
