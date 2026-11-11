import ts from "typescript";

/**
 * The texts a user can see in a source file, read with the TypeScript parser
 * (D42; shared with the writing rules of D48): JSX text, the visible
 * attributes (label, placeholder, title, alt, aria-label), string values of
 * visible properties (label, title, description, friendlyName, error…) and,
 * with `everyString`, every string of the file (the messages module). Code
 * such as .eq("status", "ACTIVE"), a comparison or an <option value> is not
 * visible text.
 */

const VISIBLE_ATTRIBUTES = new Set(["label", "placeholder", "title", "alt", "aria-label", "aria-description", "aria-placeholder"]);
const VISIBLE_PROPERTIES = new Set(["label", "title", "description", "placeholder", "alt", "heading", "friendlyName", "error", "message"]);
const PASS_THROUGH_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.PlusToken,
]);

function propertyName(name: ts.PropertyName): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : "";
}

/** The visible strings of one file. `everyString` treats every string literal as visible (the messages module). */
export function visibleTexts(source: string, fileName: string, everyString = false): string[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];

  const isVisible = (literal: ts.Node): boolean => {
    let child: ts.Node = literal;
    let parent: ts.Node | undefined = literal.parent;
    while (parent) {
      if (ts.isJsxAttribute(parent)) return VISIBLE_ATTRIBUTES.has(parent.name.getText(file));
      if (ts.isJsxExpression(parent)) return ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent);
      if (ts.isPropertyAssignment(parent)) return parent.initializer === child && VISIBLE_PROPERTIES.has(propertyName(parent.name));
      if (ts.isConditionalExpression(parent)) {
        if (parent.condition === child) return false;
      } else if (ts.isBinaryExpression(parent)) {
        if (!PASS_THROUGH_OPERATORS.has(parent.operatorToken.kind)) return false;
      } else if (!(ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent))) {
        return false;
      }
      child = parent;
      parent = parent.parent;
    }
    return false;
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxText(node)) {
      const text = node.getText(file).trim();
      if (text) found.push(text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!ts.isPropertyAssignment(node.parent) || node.parent.name !== node) {
        if (everyString || isVisible(node)) found.push(node.text);
      }
    } else if (ts.isTemplateExpression(node)) {
      if (everyString || isVisible(node)) {
        found.push([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" "));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
