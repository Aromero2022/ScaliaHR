// Worker logs as JSON lines (D27), like the web app's, with the job id and the
// tenant id when the job has one. Payloads are never logged; error messages go
// through the web app's own list of masks, @scaliahr/email/log-masks (D53):
// email addresses, JWTs, Bearer/Basic tokens, CURP, RFC, CLABE, card numbers
// and NSS. An SMTP rejection that quotes the recipient is logged without it.
import { maskText } from "@scaliahr/email/log-masks";

type Level = "info" | "warn" | "error";

export function mask(text: string): string {
  return maskText(text);
}

export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return { name: error.name, message: mask(error.message), ...(code !== undefined && { code }) };
  }
  return { message: mask(String(error)) };
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  if (level === "info") console.log(line);
  else console.error(line);
}
