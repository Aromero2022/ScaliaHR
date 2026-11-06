import { describe, expect, it } from "vitest";
import { isServerActionFile, moduleExports, sourceFiles } from "./source-exports";

/**
 * D31: every Server Action that takes input validates it with zod before
 * using it, and "use server" marks only real Server Actions. Files are read
 * with the TypeScript parser (source-exports.ts), so each action's body is
 * exactly its own, and any export the test does not understand fails it: no
 * action is invisible.
 */

const VALIDATES = /\.(?:safeParse|parse)\(/;
const actionFiles = sourceFiles().filter(({ source }) => isServerActionFile(source));

/** In a "use server" file every exported function is a Server Action. */
const serverExports = (source: string) => {
  const { functions, unrecognized } = moduleExports(source);
  return { actions: functions, unrecognized };
};

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
