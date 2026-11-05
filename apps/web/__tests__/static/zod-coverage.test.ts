import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * D31: every Server Action that takes input validates it with zod before
 * using it, and "use server" marks only real Server Actions.
 */

const SRC = path.resolve(__dirname, "../../src");
const VALIDATES = /\.(?:safeParse|parse)\(/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const actionFiles = files(SRC)
  .map((file) => ({ rel: path.relative(SRC, file), source: readFileSync(file, "utf-8") }))
  .filter(({ source }) => /^["']use server["']/m.test(source));

/** Exported functions with their parameter list and body (up to the next export). */
function exportedFunctions(source: string) {
  return source
    .split(/^export /m)
    .slice(1)
    .map((chunk) => {
      const match = /^(?:async )?function (\w+)\s*\(([^)]*)\)/.exec(chunk);
      return match && { name: match[1], params: match[2].trim(), body: chunk };
    })
    .filter((fn): fn is { name: string; params: string; body: string } => fn !== null);
}

describe("zod in every Server Action (D31)", () => {
  it("flags an action that takes input without parsing it", () => {
    const source = 'export async function a(input: unknown) {\n  return S.safeParse(input);\n}\nexport async function b(id: string) {\n  return id;\n}\nexport async function c() {}\n';
    const missing = exportedFunctions(source).filter((fn) => fn.params && !VALIDATES.test(fn.body));
    expect(missing.map((fn) => fn.name)).toEqual(["b"]);
  });

  it("only real Server Actions carry \"use server\"", () => {
    expect(actionFiles.map(({ rel }) => rel).sort()).toEqual([
      "app/(protected)/admin-center/actions.ts",
      "app/(protected)/admin/arco/actions.ts",
      "app/(protected)/employees/[id]/actions.ts",
      "app/(protected)/mfa/actions.ts",
      "app/(protected)/performance/actions.ts",
      "app/(protected)/skills-hub/actions.ts",
      "app/login/actions.ts",
      "lib/admin/create-tenant.ts",
      "lib/tenant/actions.ts",
    ]);
  });

  for (const { rel, source } of actionFiles) {
    it(`every Server Action with input in ${rel} validates it with zod`, () => {
      const missing = exportedFunctions(source)
        .filter((fn) => fn.params !== "" && !VALIDATES.test(fn.body))
        .map((fn) => fn.name);
      expect(missing).toEqual([]);
    });
  }
});
