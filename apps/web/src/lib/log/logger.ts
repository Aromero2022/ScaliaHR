import { redact } from "./redact";

// Structured logs (D27): one JSON object per line on stdout, with the request
// id and tenant id of the request when there is one. Runs on the Node and Edge
// runtimes (middleware), so it uses console only.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  tenantId?: string;
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}, ctx: LogContext = {}): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...(ctx.requestId && { requestId: ctx.requestId }),
    ...(ctx.tenantId && { tenantId: ctx.tenantId }),
    ...(redact(fields) as Record<string, unknown>),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}
