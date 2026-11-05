// Redaction for everything that reaches the logs (D27). Keys that name a secret
// or a sensitive personal field are blanked whatever their value; inside any
// other string, tokens and Mexican identifiers are masked by pattern, because
// database errors quote the offending values ("Key (rfc)=(…) already exists").

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|jwt|curp|rfc|nss|clabe|salary|salario|sueldo|bank|account_number/i;

const PATTERNS: [RegExp, string][] = [
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

export function redactString(value: string): string {
  return PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[DEPTH]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) return serializeError(value, depth);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1)]),
    );
  }
  return value;
}

/** Errors and Supabase/PostgREST error objects as plain, redacted fields. */
export function serializeError(error: unknown, depth = 0): Record<string, unknown> {
  if (error instanceof Error) {
    const extra = error as Error & { code?: unknown; digest?: unknown; cause?: unknown };
    return {
      name: error.name,
      message: redactString(error.message),
      ...(extra.code !== undefined && { code: extra.code }),
      ...(extra.digest !== undefined && { digest: extra.digest }),
      ...(error.stack && { stack: redactString(error.stack) }),
      ...(extra.cause !== undefined && { cause: redact(extra.cause, depth + 1) }),
    };
  }
  if (error && typeof error === "object") return redact(error, depth + 1) as Record<string, unknown>;
  return { message: redactString(String(error)) };
}
