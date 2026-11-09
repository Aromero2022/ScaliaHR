import { cache } from "react";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import { safeError } from "@/lib/errors/safe-error";
import { messages } from "@/lib/i18n/es-MX";

export type CurrentUser = { id: string; tenant_id: string; position_id: string | null };

/**
 * D45: the employee row could not be read. Not the same as having none (null):
 * the caller shows an error with the request id instead of sending the person
 * to the login as if they had no session. `userMessage` comes from safeError().
 */
export class CurrentUserUnavailable extends Error {
  constructor(readonly userMessage: string) {
    super("the current user's employee row could not be read");
    this.name = "CurrentUserUnavailable";
  }
}

/**
 * D35: the signed-in person's employee row, read once per request (the
 * layout, the page and its server components share it). Read with the user's
 * own client, so RLS applies as before. Null when the account has no employee
 * row (a valid case: maybeSingle, D45); throws CurrentUserUnavailable when the
 * query fails.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const claims = await getClaims();
  if (!claims) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, tenant_id, position_id")
    .eq("auth_uid", claims.userId)
    .maybeSingle<CurrentUser>();
  if (error) throw new CurrentUserUnavailable(await safeError("auth.current_user", error, messages.common.pageLoadError));
  return data;
});

/**
 * D45: getCurrentUser for a Server Action or a route handler, which answer with
 * a message instead of an error page. `error` is safeError()'s message (generic
 * text and request id) when the employee row could not be read; the detail is
 * already in the logs.
 */
export async function currentUserOrError(): Promise<{ user: CurrentUser | null; error: string | null }> {
  try {
    return { user: await getCurrentUser(), error: null };
  } catch (error) {
    if (error instanceof CurrentUserUnavailable) return { user: null, error: error.userMessage };
    throw error;
  }
}
