import { cache } from "react";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = { id: string; tenant_id: string; position_id: string | null };

/**
 * D35: the signed-in person's employee row, read once per request (the
 * layout, the page and its server components share it). Read with the user's
 * own client, so RLS applies as before.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const claims = await getClaims();
  if (!claims) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, tenant_id, position_id")
    .eq("auth_uid", claims.userId)
    .single<CurrentUser>();
  return data;
});
