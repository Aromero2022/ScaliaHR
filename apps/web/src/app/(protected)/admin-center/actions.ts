"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/lib/authz/can";
import { writeAuditLog } from "@/lib/audit/log";
import { safeError } from "@/lib/errors/safe-error";
import { limitWrite } from "@/lib/rate-limit";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import { currentUserOrError } from "@/lib/auth/current-user";

// Same bounds as the CHECK constraints of public.tenant_rate_limits (D28).
const TenantRateLimit = z.object({
  action: z.enum(["write", "api"], "Límite desconocido"),
  maxTokens: z.coerce.number().int("Usa un número entero").min(1, "Mínimo 1 solicitud").max(600, "Máximo 600 solicitudes"),
  windowSeconds: z.coerce
    .number()
    .int("Usa un número entero")
    .min(10, "La ventana mínima es de 10 segundos")
    .max(3600, "La ventana máxima es de 3600 segundos"),
});

/** D28: a tenant admin changes the write or API limit of their own tenant. */
export async function updateTenantRateLimit(input: unknown): Promise<{ error?: string }> {
  const limited = await limitWrite();
  if (limited) return { error: limited };

  const parsed = TenantRateLimit.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const claims = await getClaims();
  if (!claims?.tenantId) return { error: "No autenticado" };
  if (claims.aal !== "aal2") return { error: "Verifica tu identidad con MFA para cambiar la configuración" };

  const supabase = await createClient();
  // D45: a failed read of the employee row returns its safe error, not "No autenticado".
  const { user: bizUser, error: userError } = await currentUserOrError();
  if (userError) return { error: userError };
  if (!bizUser) return { error: "No autenticado" };

  const { allowed } = await can(bizUser.id, "admin.manage_config", "edit");
  if (!allowed) return { error: "Sin permiso para cambiar la configuración" };

  const { action, maxTokens, windowSeconds } = parsed.data;
  const { error } = await supabase.from("tenant_rate_limits").upsert(
    {
      tenant_id: claims.tenantId,
      action,
      max_tokens: maxTokens,
      window_seconds: windowSeconds,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,action" },
  );
  if (error) return { error: await safeError("admin.rate_limit_update", error, "No se pudo guardar el límite.") };

  await writeAuditLog({
    tenantId: claims.tenantId,
    actorId: bizUser.id,
    action: "RATE_LIMIT_UPDATED",
    entity: "tenant_rate_limits",
    diff: { action, max_tokens: maxTokens, window_seconds: windowSeconds },
  });

  revalidatePath("/admin-center");
  return {};
}
