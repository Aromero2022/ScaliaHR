import ts from "typescript";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "./source-exports";

/**
 * D47: performance_score and potential_score are not readable by authenticated
 * (column privileges), so a query that asks PostgREST for every column of
 * users fails with 42501. Read with the TypeScript parser, it reports:
 * - .from("users").select() with no argument, a top-level "*" or an argument
 *   it cannot read (not a string literal);
 * - an embed of users with "*" in any select string, e.g. "author:users(*)".
 */

type Finding = { line: number; reason: string };

const USERS_EMBED_STAR = /(^|[\s,(:])users(![\w]+)?\s*\(\s*\*/;

/** The top-level items of a PostgREST select string (commas inside parentheses do not split). */
function topLevelItems(select: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of select) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      items.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  items.push(current.trim());
  return items;
}

const literalText = (node: ts.Node | undefined): string | null =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

function selectStarOnUsers(source: string): Finding[] {
  const file = ts.createSourceFile("file.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Finding[] = [];
  const line = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "select") {
      const arg = node.arguments[0];
      const text = literalText(arg);
      if (text !== null && USERS_EMBED_STAR.test(text)) found.push({ line: line(node), reason: "an embed of users selects *" });

      // Does this select belong to a chain that starts at .from("users")?
      let receiver: ts.Expression = node.expression.expression;
      let fromUsers = false;
      while (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression)) {
        if (receiver.expression.name.text === "from" && literalText(receiver.arguments[0]) === "users") {
          fromUsers = true;
          break;
        }
        receiver = receiver.expression.expression;
      }
      if (fromUsers) {
        if (!arg) found.push({ line: line(node), reason: "users is selected without columns (*)" });
        else if (text === null) found.push({ line: line(node), reason: "the columns of users cannot be read (not a string literal)" });
        else if (topLevelItems(text).some((item) => item.startsWith("*"))) found.push({ line: line(node), reason: "users is selected with *" });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const reasons = (source: string) => selectStarOnUsers(source).map(({ line, reason }) => `${line}: ${reason}`);

describe("users is never selected with * (D47)", () => {
  it("negative controls: every form of * on users is reported", () => {
    const source = [
      'supabase.from("users").select("*");',
      'supabase.from("users").select("*, departments(name)").eq("id", id);',
      'supabase.from("users").select();',
      "supabase.from(`users`).select(COLUMNS);",
      'supabase.from("users").select("*", { count: "exact", head: true });',
      'supabase.from("arco_requests").select("id, subject:users!arco_subject_fk(*)");',
      'supabase.from("positions").select("id, occupants:users( * )");',
    ].join("\n");
    expect(reasons(source)).toEqual([
      "1: users is selected with *",
      "2: users is selected with *",
      "3: users is selected without columns (*)",
      "4: the columns of users cannot be read (not a string literal)",
      "5: users is selected with *",
      "6: an embed of users selects *",
      "7: an embed of users selects *",
    ]);
  });

  it("positive controls: explicit columns, * of other tables and * inside other embeds pass", () => {
    const source = [
      'supabase.from("users").select("id, first_name, departments(name)");',
      'supabase.from("users").select("id", { count: "exact", head: true });',
      'supabase.from("users").select("id, departments(*)");',
      'supabase.from("ec_compensation").select("*");',
      'supabase.from("continuous_feedbacks").select("*, author:users!fk(first_name, last_name)");',
      'supabase.from("superusers_log").select("*");',
    ].join("\n");
    expect(reasons(source)).toEqual([]);
  });

  for (const { rel, source } of sourceFiles()) {
    const found = selectStarOnUsers(source);
    it(`${rel} selects explicit columns of users`, () => {
      expect(found.map(({ line, reason }) => `${line}: ${reason}`)).toEqual([]);
    });
  }
});
