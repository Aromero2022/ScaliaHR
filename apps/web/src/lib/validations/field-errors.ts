// 9c PR 6d: the errors of a zod parse by field, for a form that shows each one
// next to its control. The key is the first segment of the issue's path and the
// first message of a field wins. The messages come only from our schemas, never
// from the database (D27).

export interface IssueLike {
  path: readonly PropertyKey[];
  message: string;
}

export function toFieldErrors(issues: readonly IssueLike[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key !== "string" || Object.hasOwn(errors, key)) continue;
    errors[key] = issue.message;
  }
  return errors;
}
