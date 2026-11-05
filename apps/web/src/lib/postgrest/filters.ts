/**
 * Builders for PostgREST logic filters (`.or()`), which supabase-js sends as
 * written. A value pasted in raw can close the group and add conditions: "a,id.eq.1)("
 * turns one search into extra filters. Each value goes inside double quotes,
 * where , . : ( ) are plain text, with \ and " escaped. Column names are
 * constants written by the caller, never user input.
 */

/** A PostgREST filter value in double quotes (`\` and `"` escaped). */
export function quoted(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

/**
 * ILIKE pattern matching `text` anywhere, as plain text: the LIKE wildcards
 * % and _ (and the escape \) are escaped. `*` is dropped because PostgREST
 * turns it into % before it reaches SQL, so it cannot be matched literally.
 */
export function containsPattern(text: string): string {
  return `%${text.replaceAll("*", "").replace(/[\\%_]/g, "\\$&")}%`;
}

/** `col1.ilike."%text%",col2.ilike."%text%"…` for `.or()`. */
export function ilikeAnyOf(columns: readonly string[], text: string): string {
  const value = quoted(containsPattern(text));
  return columns.map((column) => `${column}.ilike.${value}`).join(",");
}

/** `col1.eq."value",col2.eq."value"…` for `.or()`. */
export function eqAnyOf(columns: readonly string[], value: string): string {
  const v = quoted(value);
  return columns.map((column) => `${column}.eq.${v}`).join(",");
}
