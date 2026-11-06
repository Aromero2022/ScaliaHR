import { describe, expect, it } from "vitest";
import ts from "typescript";
import { sourceFiles } from "./source-exports";

/**
 * D42: dates are formatted on the server, with the tenant's time zone, and
 * client components receive the text. A "use client" file that formats or
 * builds a date would show the browser's zone and could differ from the
 * server render (a hydration error). This fails on the date APIs in such a
 * file and on an import of lib/format/dates from one.
 */

const DATE_METHODS = new Set(["toLocaleDateString", "toLocaleTimeString", "toLocaleString", "toISOString", "toDateString", "toTimeString", "getTimezoneOffset"]);
const INTL_FORMATS = new Set(["DateTimeFormat", "RelativeTimeFormat"]);

export function clientDateFormatting(source: string, fileName = "file.tsx"): string[] {
  if (!/^\s*["']use client["']/.test(source)) return [];
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /(^|\/)lib\/format\/dates$/.test(node.moduleSpecifier.text)) {
      found.push(`import ${node.moduleSpecifier.text}`);
    }
    if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text;
      if (DATE_METHODS.has(name)) found.push(`.${name}()`);
      if (INTL_FORMATS.has(name) && node.expression.getText(file) === "Intl") found.push(`Intl.${name}`);
    }
    if (ts.isNewExpression(node) && node.expression.getText(file) === "Date") found.push("new Date()");
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("client components never format dates (D42)", () => {
  it('no "use client" file formats or builds a date', () => {
    const hits = sourceFiles().flatMap(({ rel, source }) => clientDateFormatting(source, rel).map((hit) => `${rel}: ${hit}`));
    expect(hits).toEqual([]);
  });

  it("catches each way of doing it (negative control)", () => {
    const source = `"use client";
      import { formatInstant } from "@/lib/format/dates";
      export function A({ at }: { at: string }) {
        const today = new Date().toISOString().slice(0, 10);
        const a = new Date(at).toLocaleDateString("es-MX");
        const b = new Intl.DateTimeFormat("es-MX").format(new Date(at));
        return <span>{today}{a}{b}{new Date(at).toLocaleString()}</span>;
      }`;
    expect(clientDateFormatting(source).sort()).toEqual(
      [
        "import @/lib/format/dates",
        "new Date()", "new Date()", "new Date()", "new Date()",
        ".toISOString()", ".toLocaleDateString()", ".toLocaleString()",
        "Intl.DateTimeFormat",
      ].sort(),
    );
  });

  it("leaves server files alone", () => {
    expect(clientDateFormatting(`export const x = new Date().toLocaleDateString("es-MX");`)).toEqual([]);
  });
});
