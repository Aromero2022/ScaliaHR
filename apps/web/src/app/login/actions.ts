"use server";

import { getClaims } from "@/lib/supabase/claims";
import { writeAuditLog } from "@/lib/audit/log";
import { createClient } from "@/lib/supabase/server";

export async function logLoginEvent(): Promise<void> {
  const claims = await getClaims();
  if (!claims?.tenantId) return;

  const sb = await createClient();
  const { data: bizUser } = await sb
    .from("users")
    .select("id")
    .eq("auth_uid", claims.userId)
    .single();

  if (!bizUser) return;

  await writeAuditLog({
    tenantId: claims.tenantId,
    actorId: bizUser.id,
    action: "AUTH_LOGIN",
    entity: "session",
  });
}
