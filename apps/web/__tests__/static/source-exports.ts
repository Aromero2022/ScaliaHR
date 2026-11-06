import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Shared by the static tests (D28, D31): the files under src and what each one
 * exports, read with the TypeScript parser so every function's body is
 * exactly its own and arrow functions count as functions too.
 */

export const SRC = path.resolve(__dirname, "../../src");

export type SourceFile = { rel: string; source: string };
export type ExportedFunction = { name: string; params: number; body: string };

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

export function sourceFiles(): SourceFile[] {
  return walk(SRC).map((file) => ({ rel: path.relative(SRC, file), source: readFileSync(file, "utf-8") }));
}

export function isServerActionFile(source: string): boolean {
  return /^["']use server["']/m.test(source);
}

/**
 * Exported functions (`function` declarations and `const x = async (...) => …`
 * or `= async function`) and every other export. Type-only exports are left
 * out of both lists; `export default`, `export { }`, `export *`, constants and
 * classes go to `unrecognized`.
 */
export function moduleExports(source: string): { functions: ExportedFunction[]; unrecognized: string[] } {
  const file = ts.createSourceFile("module.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions: ExportedFunction[] = [];
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
      functions.push({ name: statement.name.text, params: statement.parameters.length, body: statement.body.getText(file) });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (ts.isIdentifier(declaration.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          functions.push({ name: declaration.name.text, params: init.parameters.length, body: init.body.getText(file) });
        } else {
          unrecognized.push(short(declaration));
        }
      }
      continue;
    }
    unrecognized.push(short(statement)); // export class, enum…
  }
  return { functions, unrecognized };
}
