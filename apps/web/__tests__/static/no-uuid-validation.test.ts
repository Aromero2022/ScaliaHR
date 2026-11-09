import ts from "typescript";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "./source-exports";

/**
 * D46: ids are validated with z.guid(). z.uuid() (and z.string().uuid(),
 * z.uuidv4()…) require an RFC 4122 version and variant, which the seed's ids
 * (e0000000-…, 5c000000-…, aa100000-…) do not have: every Server Action that
 * used it refused demo data, so "Tomar Acción", ARCO and "Evaluar" could not
 * save. Read with the TypeScript parser: a call named uuid, uuidv4, uuidv6 or
 * uuidv7 whose chain starts at a name imported from "zod".
 */

const UUID_CHECK = /^uuid(v\d)?$/;

function uuidValidations(source: string): { line: number; text: string }[] {
  const file = ts.createSourceFile("file.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const zodNames = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!/^zod(\/.*)?$/.test(statement.moduleSpecifier.text)) continue;
    const clause = statement.importClause;
    if (clause?.name) zodNames.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) zodNames.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) zodNames.add(element.name.text);
  }

  const rootName = (node: ts.Expression): string | null => {
    let current: ts.Expression = node;
    for (;;) {
      if (ts.isIdentifier(current)) return current.text;
      if (ts.isPropertyAccessExpression(current) || ts.isCallExpression(current) || ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current)) {
        current = current.expression;
        continue;
      }
      return null;
    }
  };

  const found: { line: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      UUID_CHECK.test(node.expression.name.text)
    ) {
      const root = rootName(node.expression.expression);
      if (root && zodNames.has(root)) {
        found.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text: node.getText(file).slice(0, 80) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const lines = (source: string) => uuidValidations(source).map(({ line }) => line);

describe("ids are validated with z.guid(), never z.uuid() (D46)", () => {
  it("negative controls: every zod uuid form is reported", () => {
    const source = [
      'import { z } from "zod";',
      "const a = z.uuid();",
      "const b = z.string().uuid();",
      'const c = z.string().trim().uuid("Id inválido");',
      "const d = z.object({ id: z.string().uuid().optional() });",
      "const e = z.uuidv4();",
      "const f = z.uuidv7();",
    ].join("\n");
    expect(lines(source)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("negative control: a namespace or renamed zod import is followed too", () => {
    const source = ['import * as zod from "zod";', "const a = zod.string().uuid();", 'import { z as v } from "zod/v4";', "const b = v.uuid();"].join("\n");
    expect(lines(source)).toEqual([2, 4]);
  });

  it("positive controls: z.guid() and uuid calls that are not zod are not reported", () => {
    const source = [
      'import { z } from "zod";',
      "const a = z.guid();",
      "const b = z.object({ id: z.guid().optional() });",
      "const c = crypto.randomUUID();",
      "const d = faker.string.uuid();",
      "const e = row.uuid;",
    ].join("\n");
    expect(lines(source)).toEqual([]);
  });

  for (const { rel, source } of sourceFiles()) {
    const found = uuidValidations(source);
    it(`${rel} validates ids with z.guid()`, () => {
      expect(found.map(({ line, text }) => `${line}: ${text}`)).toEqual([]);
    });
  }
});
