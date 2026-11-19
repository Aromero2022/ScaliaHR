// Redaction for everything that reaches the logs (D27). Keys that name a secret
// or a sensitive personal field are blanked whatever their value; inside any
// other string, tokens and Mexican identifiers are masked by pattern, because
// database errors quote the offending values ("Key (rfc)=(…) already exists").
// The patterns live in @scaliahr/email/log-masks, the list the worker uses too (D53).
import { maskText } from "@scaliahr/email/log-masks";

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|jwt|curp|rfc|nss|clabe|salary|salario|sueldo|bank|account_number/i;

export function redactString(value: string): string {
  return maskText(value);
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
