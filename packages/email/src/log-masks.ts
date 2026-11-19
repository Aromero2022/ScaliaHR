// The masks for free text in the logs (D27, D53): the web app applies them to
// every string field of its log events, the worker to its error messages. One list, so the two
// cannot drift apart. The web app reads this file from source (tsconfig path)
// and the worker from dist (package export "./log-masks"). It must stay free
// of imports: the web app bundles it for the Edge runtime too.

// Order matters. Email addresses go first: the NSS and RFC masks would split an
// address and leave its domain ("[NSS]@acme.dev"). JWTs go before Bearer/Basic
// ("Bearer [JWT]"), and CLABE (18 digits) before card numbers (13-19) before
// NSS (11), so each length gets its own label.
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

/**
 * Masks email addresses, JWTs, Bearer/Basic tokens, CURP, RFC, CLABE, card
 * numbers and NSS in free text, in the order of the list. Best effort: `\w` is
 * ASCII only, so an address with accented letters or an IDN domain is not
 * masked. The patterns carry the `g` flag and are used only with `replace`,
 * which resets `lastIndex`; `test` or `exec` on them would keep state between
 * calls.
 */
export function maskText(text: string): string {
  return PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
