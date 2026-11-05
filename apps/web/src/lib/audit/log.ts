import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { reportError } from "@/lib/log/report";
import { requestContext } from "@/lib/log/request-context";

type AuditEntry = {
  tenantId: string;
  actorId: string;
  action: string;
  entity?: string;
  entityId?: string;
  diff?: Record<string, unknown>;
};

export async function writeAuditLog(entry: AuditEntry): Promise<string | null> {
  const supabase = await createClient();
  const headersList = await headers();

  const ip = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = headersList.get("user-agent") ?? null;

  const { data, error } = await supabase.rpc("write_audit_log", {
    p_tenant_id: entry.tenantId,
    p_actor_id: entry.actorId,
    p_action: entry.action,
    p_entity: entry.entity ?? null,
    p_entity_id: entry.entityId ?? null,
    p_diff: entry.diff ?? null,
    p_ip: ip,
    p_user_agent: userAgent,
  });

  if (error) {
    reportError("audit.write_failed", error, await requestContext(), { action: entry.action });
    return null;
  }

  return data as string;
}
