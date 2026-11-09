import { describe, expect, it } from "vitest";
import { isServerActionFile, moduleExports, sourceFiles } from "./source-exports";

/**
 * D28: every Server Action spends a token before doing anything, and every
 * HTTP route answers 429 when its bucket is empty. A new action or route
 * without a limiter fails here. Exports are read with the TypeScript parser
 * (source-exports.ts, shared with the zod test), so `export const x = async
 * () =>` actions are checked too and a "use server" export the parser does
 * not recognize fails the test.
 */

const LIMITER = /\b(?:limitWrite|limitRead|limitApi|consumeRateLimit)\(/;

// Healthchecks: limiting them would cost the same database round trip as the check itself.
const UNLIMITED_ROUTES = new Set(["app/api/health/route.ts"]);

const all = sourceFiles();
const actionFiles = all.filter(({ source }) => isServerActionFile(source));
const routeFiles = all.filter(({ rel }) => /(^|\/)route\.ts$/.test(rel) && !UNLIMITED_ROUTES.has(rel));
const HTTP_METHOD = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/;

const unlimited = (source: string, limiter: RegExp, only: (name: string) => boolean = () => true) =>
  moduleExports(source)
    .functions.filter(({ name }) => only(name))
    .filter(({ body }) => !limiter.test(body))
    .map(({ name }) => name);

describe("rate limiting coverage (D28)", () => {
  it("finds the Server Actions and routes it checks", () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(8);
    expect(routeFiles.map(({ rel }) => rel)).toEqual(
      expect.arrayContaining(["app/(protected)/lms/launch/route.ts", "app/api/colleagues/route.ts"]),
    );
  });

  it("flags an exported function without a limiter, whatever its form", () => {
    const source = [
      "export async function a() {\n  await limitWrite();\n}",
      "export async function b() {\n  return 1;\n}",
      "export const c = async (input: unknown) => {\n  await limitWrite();\n  return input;\n};",
      "export const d = async (input: unknown) => input;",
      "export const e = async function () {\n  return 1;\n};",
      // A helper further down that spends a token does not cover the action above it.
      "export async function f() {\n  return helper();\n}\nasync function helper() {\n  return limitWrite();\n}",
    ].join("\n");
    expect(unlimited(source, LIMITER)).toEqual(["b", "d", "e", "f"]);
  });

  it("flags a route handler written as a const without limitApi", () => {
    const source = 'export const dynamic = "force-dynamic";\nexport const GET = async () => new Response("ok");\nexport async function POST() {\n  const limited = await limitApi();\n  return limited ?? new Response("ok");\n}';
    expect(unlimited(source, /\blimitApi\(/, (name) => HTTP_METHOD.test(name))).toEqual(["GET"]);
  });

  for (const { rel, source } of actionFiles) {
    it(`every Server Action in ${rel} spends a token, and no export is hidden from the check`, () => {
      expect(moduleExports(source).unrecognized).toEqual([]);
      expect(unlimited(source, LIMITER)).toEqual([]);
    });
  }

  for (const { rel, source } of routeFiles) {
    it(`every handler in ${rel} spends a token`, () => {
      expect(unlimited(source, /\blimitApi\(/, (name) => HTTP_METHOD.test(name))).toEqual([]);
    });
  }
});
