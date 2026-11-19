// The masks that every log line of the web app and the worker applies to free
// text (D27, D53): one list, so the two cannot drift apart. The web app reads
// this file from source (tsconfig path) and the worker from dist (package
// export "./log-masks"). It must stay free of imports: the web app bundles it
// for the Edge runtime too.

const PATTERNS: readonly (readonly [RegExp, string])[] = [
  // 9c PR 6c: email addresses, which a database error can quote from a search or a duplicate key
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[EMAIL]"],
  // JWTs and bearer tokens
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[JWT]"],
  [/\b(Bearer|Basic)\s+[\w.+/=-]+/gi, "$1 [REDACTED]"],
  // CURP: 4 letters, 6 digits, H/M, 5 letters, 2 alphanumerics
  [/(?<![A-Z\d])[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]\d(?![A-Z\d])/gi, "[CURP]"],
  // RFC: 3-4 letters (incl. Ñ and &), 6 digits, 3 alphanumerics
  [/(?<![A-ZÑ&\d])[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}(?![A-Z\d])/gi, "[RFC]"],
  // CLABE (18 digits), card numbers (13-19), NSS (11 digits)
  [/\b\d{18}\b/g, "[CLABE]"],
  [/\b\d{13,19}\b/g, "[NUMBER]"],
  [/\b\d{11}\b/g, "[NSS]"],
];

/** Masks email addresses, tokens and Mexican identifiers in free text, in this order. */
export function maskText(text: string): string {
  return PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
