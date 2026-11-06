import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { SRC, sourceFiles } from "./source-exports";

/**
 * D43: one primary button per view. The exact rule:
 * - A primary is a <Button> or <ButtonLink> whose variant is omitted or
 *   "primary", or a <button>, <a> or <Link> whose className has a fixed string
 *   (not inside a condition) with both bg-accent and text-on-accent. A selected
 *   state drawn with those classes inside a condition (tabs, filters) is not a
 *   primary.
 * - A view is a page.tsx plus the components it renders directly (imported by
 *   the page and used in its JSX, one level deep), with the local components
 *   declared in those files. components/ui/ is not expanded: a <Button> counts
 *   where it is used.
 * - What is inside a <Dialog> or a native <dialog> is a view of its own.
 * - The branches of a conditional (a ? X : Y), and sibling && blocks that
 *   compare the same value with different literals (tab === "goals" && …,
 *   tab === "feedback" && …), are alternatives: the largest counts, not the sum.
 */

type Load = (rel: string) => string | null;

const PRIMARY_TAGS = new Set(["button", "a", "Link"]);
const BUTTON_TAGS = new Set(["Button", "ButtonLink"]);
const DIALOG_TAGS = new Set(["Dialog", "dialog"]);

function parse(rel: string, source: string) {
  return ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** Strings in a className value that are always applied (not behind a condition). */
function fixedClassStrings(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
  if (ts.isJsxExpression(node) && node.expression) return fixedClassStrings(node.expression);
  if (ts.isParenthesizedExpression(node)) return fixedClassStrings(node.expression);
  if (ts.isCallExpression(node)) return node.arguments.flatMap((a) => fixedClassStrings(a)); // clsx("…", cond && "…")
  return []; // conditionals, &&, objects: not fixed
}

function attribute(element: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return element.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
}

function isPrimary(element: ts.JsxOpeningLikeElement): boolean {
  const tag = element.tagName.getText();
  if (BUTTON_TAGS.has(tag)) {
    const variant = attribute(element, "variant");
    if (!variant?.initializer) return true;
    const value = ts.isStringLiteral(variant.initializer)
      ? variant.initializer.text
      : ts.isJsxExpression(variant.initializer) && variant.initializer.expression && ts.isStringLiteral(variant.initializer.expression)
        ? variant.initializer.expression.text
        : "primary"; // an expression may be primary
    return value === "primary";
  }
  if (!PRIMARY_TAGS.has(tag)) return false;
  const className = attribute(element, "className")?.initializer;
  if (!className) return false;
  const fixed = fixedClassStrings(className).join(" ");
  return /(?<![\w-])bg-accent(?![\w-])/.test(fixed) && /(?<![\w-])text-on-accent(?![\w-])/.test(fixed);
}

/** `x === "lit" && …`: the compared expression, for grouping sibling alternatives. */
function discriminant(node: ts.Node): string | null {
  const expr = ts.isJsxExpression(node) ? node.expression : node;
  if (!expr || !ts.isBinaryExpression(expr) || expr.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) return null;
  const test = expr.left;
  if (!ts.isBinaryExpression(test) || test.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return null;
  const literal = ts.isStringLiteral(test.right) ? test.left : ts.isStringLiteral(test.left) ? test.right : null;
  return literal ? literal.getText() : null;
}

type Counter = { count: (node: ts.Node) => number; dialogs: { where: string; count: number }[] };

function counter(fileRel: string, sf: ts.SourceFile): Counter {
  const dialogs: { where: string; count: number }[] = [];

  const sumChildren = (children: readonly ts.Node[]): number => {
    let total = 0;
    const groups = new Map<string, number>();
    for (const child of children) {
      const key = discriminant(child);
      const n = count(child);
      if (key) groups.set(key, Math.max(groups.get(key) ?? 0, n));
      else total += n;
    }
    for (const n of groups.values()) total += n;
    return total;
  };

  const count = (node: ts.Node): number => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText();
      const inner = ts.isJsxElement(node) ? sumChildren(node.children) : 0;
      const own = (isPrimary(opening) ? 1 : 0) + sumChildren(opening.attributes.properties.map((p) => p));
      if (DIALOG_TAGS.has(tag)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        dialogs.push({ where: `${fileRel}:${line}`, count: inner + own });
        return 0;
      }
      return own + inner;
    }
    if (ts.isJsxFragment(node)) return sumChildren(node.children);
    if (ts.isConditionalExpression(node)) return Math.max(count(node.whenTrue), count(node.whenFalse));
    const children: ts.Node[] = [];
    ts.forEachChild(node, (c) => {
      children.push(c);
    });
    return sumChildren(children);
  };

  return { count, dialogs };
}

/** Components a page renders directly: its imports used as JSX tags, resolved to files under src (not components/ui). */
function renderedImports(rel: string, sf: ts.SourceFile, exists: (rel: string) => boolean): string[] {
  const tags = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) tags.add(n.tagName.getText());
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const files: string[] = [];
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue;
    const clause = statement.importClause;
    const names = [clause?.name?.text, ...(clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.map((e) => e.name.text) : [])];
    if (!names.some((name) => name && tags.has(name))) continue;
    const spec = statement.moduleSpecifier.text;
    const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? path.posix.join(path.posix.dirname(rel), spec) : null;
    if (!base || base.startsWith("components/ui/")) continue;
    const file = [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`].find(exists);
    if (file) files.push(file);
  }
  return files;
}

export function primaryCounts(pages: string[], load: Load, allFiles: string[]) {
  const exists = (rel: string) => load(rel) !== null;
  const views = pages.map((page) => {
    const files = [page, ...renderedImports(page, parse(page, load(page)!), exists)];
    const total = files.reduce((sum, rel) => sum + counter(rel, parse(rel, load(rel)!)).count(parse(rel, load(rel)!)), 0);
    return { page, files, count: total };
  });
  const dialogs = allFiles.flatMap((rel) => {
    const sf = parse(rel, load(rel)!);
    const c = counter(rel, sf);
    c.count(sf);
    return c.dialogs;
  });
  return { views, dialogs };
}

describe("one primary button per view (D43)", () => {
  it("every page view and every dialog has at most one primary", () => {
    const files = sourceFiles().filter(({ rel }) => rel.endsWith(".tsx")).map(({ rel }) => rel);
    const load: Load = (rel) => {
      const full = path.join(SRC, rel);
      return existsSync(full) ? readFileSync(full, "utf-8") : null;
    };
    const pages = files.filter((rel) => /(^|\/)page\.tsx$/.test(rel));
    expect(pages.length).toBeGreaterThan(10);
    const { views, dialogs } = primaryCounts(pages, load, files);
    expect(views.filter((v) => v.count > 1).map((v) => `${v.page} (${v.files.join(", ")}): ${v.count}`)).toEqual([]);
    expect(dialogs.filter((d) => d.count > 1).map((d) => `${d.where}: ${d.count}`)).toEqual([]);
    // The rule sees the views it is meant to see.
    expect(views.find((v) => v.page === "app/(protected)/performance/page.tsx")?.files).toContain("components/performance-dashboard.tsx");
    expect(dialogs.filter((d) => d.where.startsWith("components/performance-dashboard.tsx")).map((d) => d.count)).toEqual([1, 1]);
  });

  const run = (fixtures: Record<string, string>) => {
    const load: Load = (rel) => fixtures[rel] ?? null;
    const all = Object.keys(fixtures);
    return primaryCounts(all.filter((f) => f.endsWith("page.tsx")), load, all);
  };

  it("fails with two primaries in a page or in a dialog (negative control)", () => {
    const two = run({
      "app/x/page.tsx": `import Panel from "@/components/panel";
        export default function Page() { return <main><Button>Guardar</Button><Panel /></main>; }`,
      "components/panel.tsx": `export default function Panel() {
        return <div><button className="rounded bg-accent px-4 text-on-accent">Enviar</button>
          <Dialog open title="x"><Button type="submit">A</Button><ButtonLink href="/b">B</ButtonLink></Dialog></div>; }`,
    });
    expect(two.views[0].count).toBe(2);
    expect(two.dialogs.map((d) => d.count)).toEqual([2]);
  });

  it("allows one in the page plus one in its dialog, tab alternatives and selected filters", () => {
    const ok = run({
      "app/x/page.tsx": `export default function Page({ tab, on }: { tab: string; on: boolean }) {
        return <main>
          {tab === "goals" && <Button>Nuevo objetivo</Button>}
          {tab === "feedback" && <Button>Enviar feedback</Button>}
          {on ? <Button>Uno</Button> : <Button variant="primary">Otro</Button>}
          <Button variant="secondary">Cancelar</Button>
          <button className={on ? "bg-accent text-on-accent" : "bg-surface text-fg"}>Filtro</button>
          <button className={clsx("rounded", on && "bg-accent text-on-accent")}>Filtro 2</button>
          <a className="bg-accent-subtle text-accent-fg">Enlace</a>
          <dialog><Button type="submit">Guardar</Button><Button variant="ghost">Cerrar</Button></dialog>
        </main>; }`,
    });
    expect(ok.views[0].count).toBe(2); // the tab group counts 1 and the conditional counts 1
    expect(ok.dialogs.map((d) => d.count)).toEqual([1]);
    const single = run({
      "app/y/page.tsx": `export default function Page({ tab }: { tab: string }) {
        return <main>{tab === "goals" && <Button>A</Button>}{tab === "feedback" && <Button>B</Button>}</main>; }`,
    });
    expect(single.views[0].count).toBe(1);
  });
});
