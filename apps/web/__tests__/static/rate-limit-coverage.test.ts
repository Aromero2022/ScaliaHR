import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * D28: every Server Action spends a token before doing anything, and every
 * HTTP route answers 429 when its bucket is empty. A new action or route
 * without a limiter fails here.
 */

const SRC = path.resolve(__dirname, "../../src");
const LIMITER = /\b(?:limitWrite|limitApi|consumeRateLimit)\(/;

// Not Server Actions despite the directive; Phase 9b PR 4 removes "use server" from them.
const NOT_ACTIONS = new Set(["lib/jobs/lms-sync.ts", "lib/lms/provision-tenant.ts", "lib/tenant/get-module-flags.ts"]);
// Healthchecks: limiting them would cost the same database round trip as the check itself.
const UNLIMITED_ROUTES = new Set(["app/api/health/route.ts"]);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const all = files(SRC).map((file) => ({ rel: path.relative(SRC, file), source: readFileSync(file, "utf-8") }));
const actionFiles = all.filter(({ rel, source }) => /^["']use server["']/m.test(source) && !NOT_ACTIONS.has(rel));
const routeFiles = all.filter(({ rel }) => /(^|\/)route\.ts$/.test(rel) && !UNLIMITED_ROUTES.has(rel));

/** Each exported function with its body (up to the next top-level export). */
function exportedFunctions(source: string): { name: string; body: string }[] {
  return source
    .split(/^export /m)
    .slice(1)
    .map((chunk) => ({ name: /^(?:async )?function (\w+)/.exec(chunk)?.[1] ?? "", body: chunk }))
    .filter(({ name }) => name !== "");
}

describe("rate limiting coverage (D28)", () => {
  it("finds the Server Actions and routes it checks", () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(8);
    expect(routeFiles.map(({ rel }) => rel)).toContain("app/(protected)/lms/launch/route.ts");
  });

  it("flags an exported function without a limiter", () => {
    const source = "export async function a() {\n  await limitWrite();\n}\nexport async function b() {\n  return 1;\n}\n";
    const missing = exportedFunctions(source).filter(({ body }) => !LIMITER.test(body));
    expect(missing.map(({ name }) => name)).toEqual(["b"]);
  });

  for (const { rel, source } of actionFiles) {
    it(`every Server Action in ${rel} spends a token`, () => {
      const missing = exportedFunctions(source)
        .filter(({ body }) => !LIMITER.test(body))
        .map(({ name }) => name);
      expect(missing).toEqual([]);
    });
  }

  for (const { rel, source } of routeFiles) {
    it(`every handler in ${rel} spends a token`, () => {
      const missing = exportedFunctions(source)
        .filter(({ name }) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(name))
        .filter(({ body }) => !/\blimitApi\(/.test(body))
        .map(({ name }) => name);
      expect(missing).toEqual([]);
    });
  }
});
