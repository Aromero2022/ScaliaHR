import { messages } from "@/lib/i18n/es-MX";
import { safeError } from "./safe-error";

/**
 * D45: a failed PostgREST query resolves with `data: null` and an `error`; it
 * does not throw. Code that read only `data` showed the failure as "no data".
 * This turns the error, if there is one, into what the section or page shows
 * instead: the detail goes to the JSON logs with the request id and tenant id
 * (safeError, D27), the user gets a generic text and the request id.
 */
export async function queryErrorMessage(
  event: string,
  error: unknown,
  userMessage: string = messages.common.sectionLoadError,
): Promise<string | null> {
  return error ? safeError(event, error, userMessage) : null;
}

/** The first error of several queries that feed one section, or null. */
export function firstError(...errors: unknown[]): unknown {
  return errors.find((error) => error != null) ?? null;
}
