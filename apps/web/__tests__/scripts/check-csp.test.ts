import { describe, expect, it } from "vitest";
import { cspProblems } from "../../../../scripts/check-csp.mjs";
import { contentSecurityPolicy } from "@/lib/security/csp";

/** D29: the CI check over the running image's /login. */

const csp = contentSecurityPolicy("Tm9uY2U=", { dev: false, supabaseUrl: "http://localhost:54321" });
const page = (nonce: string) => `<html><head><script src="/_next/a.js" nonce="${nonce}" async=""></script></head><body><script nonce="${nonce}">self.__next_f.push([1])</script></body></html>`;

describe("check-csp (D29)", () => {
  it("passes when every script carries the header's nonce", () => {
    expect(cspProblems(csp, page("Tm9uY2U="))).toEqual([]);
  });

  it("fails on a script without the nonce or with another one", () => {
    expect(cspProblems(csp, page("other"))).toHaveLength(2);
    expect(cspProblems(csp, '<script nonce="Tm9uY2U="></script><script>alert(1)</script>')).toEqual([
      "script without the response nonce: <script>",
    ]);
  });

  it("fails on unsafe-inline, unsafe-eval, a missing nonce or no header", () => {
    expect(cspProblems("script-src 'self' 'unsafe-inline' 'unsafe-eval'", "<script></script>")).toEqual(
      expect.arrayContaining([
        "script-src has no nonce",
        "script-src allows 'unsafe-inline'",
        "script-src allows 'unsafe-eval'",
      ]),
    );
    expect(cspProblems(null, page("x"))).toEqual(["no Content-Security-Policy header"]);
  });
});
