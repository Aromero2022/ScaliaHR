import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * D31: every Server Action that takes input validates it with zod before
 * using it, and "use server" marks only real Server Actions. Files are read
 * with the TypeScript parser, so each action's body is exactly its own, and
 * any export the test does not understand fails it: no action is invisible.
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

type Action = { name: string; params: number; body: string };

/**
 * The Server Actions of a file (exported `function` declarations and
 * `const x = async (...) => …` / `async function` expressions) and every other
 * export, which a "use server" file must not have. Type-only exports are fine.
 */
function serverExports(source: string): { actions: Action[]; unrecognized: string[] } {
  const file = ts.createSourceFile("actions.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const actions: Action[] = [];
  const unrecognized: string[] = [];
  const short = (node: ts.Node) => node.getText(file).split("\n")[0].slice(0, 80);
  const flags = (node: ts.Node) => (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []).map((m) => m.kind) : []);

  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement)) {
      unrecognized.push(short(statement)); // export default x
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      if (!statement.isTypeOnly) unrecognized.push(short(statement)); // export { x }, export * from
      continue;
    }
    const modifiers = flags(statement);
    if (!modifiers.includes(ts.SyntaxKind.ExportKeyword)) continue;
    if (modifiers.includes(ts.SyntaxKind.DefaultKeyword)) {
      unrecognized.push(short(statement)); // export default async function
      continue;
    }
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      actions.push({ name: statement.name.text, params: statement.parameters.length, body: statement.body.getText(file) });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (ts.isIdentifier(declaration.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          actions.push({ name: declaration.name.text, params: init.parameters.length, body: init.body.getText(file) });
        } else {
          unrecognized.push(short(declaration));
        }
      }
      continue;
    }
    unrecognized.push(short(statement)); // export class, enum, let x = 1…
  }
  return { actions, unrecognized };
}

const unvalidated = (source: string) =>
  serverExports(source)
    .actions.filter((action) => action.params > 0 && !VALIDATES.test(action.body))
    .map((action) => action.name);

describe("zod in every Server Action (D31)", () => {
  it("flags an action that takes input without parsing it, whatever its form", () => {
    const source = [
      "export async function a(input: unknown) {\n  return S.safeParse(input);\n}",
      "export async function b(id: string) {\n  return id;\n}",
      "export async function c() {}",
      "export const d = async (input: unknown) => {\n  return input;\n};",
      "export const e = async (input: unknown) => S.parse(input);",
      "export const f = async function (id: string) {\n  return id;\n};",
      // A helper further down that parses must not cover the action above it.
      "export async function g(id: string) {\n  return helper(id);\n}\nfunction helper(x: string) {\n  return S.parse(x);\n}",
    ].join("\n");
    expect(unvalidated(source)).toEqual(["b", "d", "f", "g"]);
  });

  it("flags exports it does not recognize, so no action is invisible", () => {
    const source = [
      "export type Result = { error?: string };",
      "export interface Input { id: string }",
      "export type { Other } from './other';",
      "export default async function hidden(id: string) { return id; }",
      "const inner = async (id: string) => id;",
      "export { inner };",
      "export * from './more';",
      "export const LIMIT = 5;",
      "export class Thing {}",
    ].join("\n");
    expect(serverExports(source).unrecognized).toEqual([
      "export default async function hidden(id: string) { return id; }",
      "export { inner };",
      "export * from './more';",
      "LIMIT = 5",
      "export class Thing {}",
    ]);
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
    it(`${rel}: only recognized exports, and every Server Action with input validates it with zod`, () => {
      const { actions, unrecognized } = serverExports(source);
      expect(unrecognized).toEqual([]);
      expect(actions.length).toBeGreaterThan(0);
      expect(unvalidated(source)).toEqual([]);
    });
  }
});
