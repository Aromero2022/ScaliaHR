// Worker logs as JSON lines (D27), like the web app's, with the job id and the
// tenant id when the job has one. Payloads are never logged; error messages go
// through the same masks as the web app (tokens, CURP, RFC, CLABE, NSS).

type Level = "info" | "warn" | "error";

const MASKS: [RegExp, string][] = [
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[JWT]"],
  [/(?<![A-Z\d])[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]\d(?![A-Z\d])/gi, "[CURP]"],
  [/(?<![A-ZÑ&\d])[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}(?![A-Z\d])/gi, "[RFC]"],
  [/\b\d{18}\b/g, "[CLABE]"],
  [/\b\d{13,19}\b/g, "[NUMBER]"],
  [/\b\d{11}\b/g, "[NSS]"],
];

export function mask(text: string): string {
  return MASKS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
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
