import { log, type LogContext } from "./logger";
import { serializeError } from "./redact";

// Error reporting behind an adapter (D27). Locally the reporter writes the
// error to the JSON logs; Phase 23 plugs Sentry into the same interface.

export interface ErrorReporter {
  report(event: string, error: unknown, ctx: LogContext, fields?: Record<string, unknown>): void;
}

export const jsonLogReporter: ErrorReporter = {
  report(event, error, ctx, fields = {}) {
    log("error", event, { ...fields, error: serializeError(error) }, ctx);
  },
};

let reporter: ErrorReporter = jsonLogReporter;

/** Swaps the reporter (Phase 23: Sentry). Tests use it to observe reports. */
export function setErrorReporter(next: ErrorReporter): void {
  reporter = next;
}

export function reportError(event: string, error: unknown, ctx: LogContext, fields?: Record<string, unknown>): void {
  reporter.report(event, error, ctx, fields);
}
