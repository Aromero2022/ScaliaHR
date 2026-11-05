import { reportError } from "@/lib/log/report";
import { requestContext } from "@/lib/log/request-context";

export const GENERIC_ERROR = "No se pudo completar la operación. Intenta de nuevo.";

/**
 * The only way a Server Action or page turns a database or service error into
 * text for the user (D27): the detail goes to the error reporter with the
 * request id and tenant id, the user gets a generic message and the request id
 * to quote when asking for help.
 */
export async function safeError(event: string, error: unknown, userMessage: string = GENERIC_ERROR): Promise<string> {
  const ctx = await requestContext();
  reportError(event, error, ctx);
  return ctx.requestId ? `${userMessage} Código: ${ctx.requestId}` : userMessage;
}
