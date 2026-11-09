import ts from "typescript";

/**
 * D45: where a Supabase query's result is used without looking at its error.
 * A failed PostgREST query resolves (it does not throw) with `data: null` and
 * an `error`; code that reads only `data` shows the failure as "no data".
 *
 * A query is a call chain that starts at `.from(…)` or `.rpc(…)` (not
 * `Array.from`). It is checked where it is awaited, directly, through a
 * variable that holds the builder (`let query = supabase.from(…)`), or inside
 * `await Promise.all([…])`. The awaited result must be bound with `error` (or
 * to a name whose `.error` is read), and that error must be read again in the
 * same function. Anything else is reported: a result thrown away, an error
 * never destructured, an error destructured and never read, a query returned
 * or passed on unawaited, or awaited inside another expression.
 */

export type UncheckedQuery = { line: number; text: string; reason: string };

const isQueryStart = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  (node.expression.name.text === "from" || node.expression.name.text === "rpc") &&
  !(ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Array");

/**
 * The outermost expression of the chain a query call belongs to. A branch of
 * `cond ? supabase.from(…) : …` belongs to the conditional: it is checked where
 * the conditional's value goes.
 */
function chainTop(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;
  for (;;) {
    const parent: ts.Node = current.parent;
    if (
      (ts.isConditionalExpression(parent) && parent.condition !== current) ||
      (ts.isPropertyAccessExpression(parent) && parent.expression === current) ||
      (ts.isCallExpression(parent) && parent.expression === current) ||
      ts.isNonNullExpression(parent) ||
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent)
    ) {
      current = parent as ts.Expression;
      continue;
    }
    return current;
  }
}

function enclosingFunction(node: ts.Node): ts.Node {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return p;
  }
  return node.getSourceFile();
}

/** Whether `name` is read anywhere in `scope` other than at `declared`. */
function isRead(scope: ts.Node, name: string, declared: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name && node !== declared) {
      const parent = node.parent;
      // A property name (`x.error`, `{ error: … }` key) is not a read of the variable.
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node);
      if (!isPropertyName) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

/** Whether `<name>.error` is read anywhere in `scope`. */
function readsErrorOf(scope: ts.Node, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "error" &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

/** Checks one binding (a destructuring pattern or a name) that receives an awaited result. */
function bindingProblem(binding: ts.BindingName, scope: ts.Node): string | null {
  if (ts.isIdentifier(binding)) {
    return readsErrorOf(scope, binding.text) ? null : `${binding.text}.error is never read`;
  }
  if (ts.isObjectBindingPattern(binding)) {
    const errorElement = binding.elements.find((e) => (e.propertyName ?? e.name).getText() === "error");
    if (!errorElement) return "error is not destructured";
    if (!ts.isIdentifier(errorElement.name)) return "error is not bound to a name";
    return isRead(scope, errorElement.name.text, errorElement.name) ? null : `${errorElement.name.text} is never read`;
  }
  return "the result is not bound in a way the check understands";
}

/** Checks where an awaited query result goes. */
function awaitedProblem(awaited: ts.AwaitExpression, scope: ts.Node): string | null {
  let node: ts.Node = awaited;
  while (ts.isParenthesizedExpression(node.parent)) node = node.parent;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) return bindingProblem(parent.name, scope);
  if (ts.isExpressionStatement(parent)) return "the result is thrown away";
  if (ts.isReturnStatement(parent) || ts.isArrowFunction(parent)) return "the result is returned unchecked";
  return "the result is used inside an expression without checking its error";
}

/** `await Promise.all([…, query, …])`: the query's slot in the array binding. */
function promiseAllProblem(element: ts.Expression, scope: ts.Node): string | null | undefined {
  const array = element.parent;
  if (!ts.isArrayLiteralExpression(array)) return undefined;
  const call = array.parent;
  if (
    !ts.isCallExpression(call) ||
    !ts.isPropertyAccessExpression(call.expression) ||
    call.expression.getText() !== "Promise.all" ||
    !ts.isAwaitExpression(call.parent)
  ) {
    return undefined;
  }
  const index = array.elements.indexOf(element);
  const declaration = call.parent.parent;
  if (!ts.isVariableDeclaration(declaration) || !ts.isArrayBindingPattern(declaration.name)) {
    return "the results of Promise.all are not bound one by one";
  }
  const slot = declaration.name.elements[index];
  if (!slot || ts.isOmittedExpression(slot)) return "its slot in the Promise.all result is not bound";
  return bindingProblem(slot.name, scope);
}

/** A builder held in a variable: every `await name` (or Promise.all slot) is checked. */
function variableProblems(declaration: ts.VariableDeclaration, scope: ts.Node): string[] {
  if (!ts.isIdentifier(declaration.name)) return ["the query is stored in a pattern"];
  const name = declaration.name.text;
  const problems: string[] = [];
  let awaitedSomewhere = false;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === name && node !== declaration.name) {
      let use: ts.Node = node;
      while (ts.isParenthesizedExpression(use.parent)) use = use.parent;
      if (ts.isAwaitExpression(use.parent)) {
        awaitedSomewhere = true;
        const problem = awaitedProblem(use.parent, scope);
        if (problem) problems.push(problem);
      } else if (ts.isArrayLiteralExpression(use.parent)) {
        awaitedSomewhere = true;
        const problem = promiseAllProblem(use as ts.Expression, scope);
        if (problem) problems.push(problem);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  if (!awaitedSomewhere) problems.push(`${name} is never awaited where its error can be read`);
  return problems;
}

export function uncheckedQueries(source: string, fileName = "file.tsx"): UncheckedQuery[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: UncheckedQuery[] = [];
  const seenTops = new Set<ts.Node>();

  const report = (node: ts.Node, reason: string) =>
    found.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text: node.getText(file).split("\n")[0].trim().slice(0, 90), reason });

  const visit = (node: ts.Node) => {
    if (isQueryStart(node)) {
      const top = chainTop(node);
      if (!seenTops.has(top)) {
        seenTops.add(top);
        const scope = enclosingFunction(top);
        let host: ts.Node = top;
        while (ts.isParenthesizedExpression(host.parent)) host = host.parent;
        const parent = host.parent;
        let problems: string[] = [];
        if (ts.isAwaitExpression(parent)) {
          const problem = awaitedProblem(parent, scope);
          if (problem) problems.push(problem);
        } else if (ts.isVariableDeclaration(parent) && parent.initializer === host) {
          problems = variableProblems(parent, scope);
        } else if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === host) {
          // `query = query.eq(…)`: the builder is refined; its declaration is checked.
        } else {
          const inPromiseAll = promiseAllProblem(host as ts.Expression, scope);
          if (inPromiseAll === undefined) problems.push("the query is not awaited where its error can be read");
          else if (inPromiseAll) problems.push(inPromiseAll);
        }
        for (const reason of problems) report(node, reason);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
