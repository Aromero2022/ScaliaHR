"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getClaims } from "@/lib/supabase/claims";
import { writeAuditLog } from "@/lib/audit/log";
import { can } from "@/lib/authz/can";
import { createHash } from "crypto";
import { safeError } from "@/lib/errors/safe-error";
import { limitWrite } from "@/lib/rate-limit";
import { currentUserOrError } from "@/lib/auth/current-user";

const uuidSchema = z.string().uuid();

type ActionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

/** The actor of the action, or the message to return (D45: a failed read is not "No autenticado"). */
async function getActorContext() {
  const claims = await getClaims();
  if (!claims?.tenantId) return "No autenticado";

  const { user, error } = await currentUserOrError();
  if (error) return error;
  if (!user) return "No autenticado";

  return { supabase: await createClient(), actorId: user.id, tenantId: claims.tenantId };
}

// ─── Create ARCO Request ──────────────────────────────────────

const createArcoSchema = z.object({
  subjectId: uuidSchema,
  requestType: z.enum(["acceso", "rectificacion", "cancelacion", "oposicion"]),
  description: z.string().min(1, "Descripción requerida"),
});

export async function createArcoRequest(
  input: z.input<typeof createArcoSchema>
): Promise<ActionResult<{ id: string }>> {
  const limited = await limitWrite();
  if (limited) return { success: false, error: limited };

  const parsed = createArcoSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const ctx = await getActorContext();
  if (typeof ctx === "string") return { success: false, error: ctx };

  const { allowed } = await can(ctx.actorId, "arco.manage", "view");
  if (!allowed) return { success: false, error: "Sin permiso para gestionar ARCO" };

  const { data: dueDate, error: dueDateError } = await ctx.supabase.rpc("compute_arco_due_date");
  if (dueDateError) return { success: false, error: await safeError("arco.due_date", dueDateError) };

  const { data, error } = await ctx.supabase
    .from("arco_requests")
    .insert({
      tenant_id: ctx.tenantId,
      requester_id: ctx.actorId,
      subject_id: parsed.data.subjectId,
      request_type: parsed.data.requestType,
      description: parsed.data.description,
      due_date: dueDate,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: await safeError("arco.create", error) };
  }

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: "arco.request_created",
    entity: "arco_requests",
    entityId: data.id,
    diff: parsed.data,
  });

  revalidatePath("/admin/arco");
  return { success: true, data: { id: data.id } };
}

// ─── Process ARCO Request ─────────────────────────────────────

const processArcoSchema = z.object({
  requestId: uuidSchema,
  action: z.enum(["approve", "reject"]),
  resolutionNotes: z.string().optional(),
});

export async function processArcoRequest(
  input: z.input<typeof processArcoSchema>
): Promise<ActionResult<{ id: string; exportHash?: string }>> {
  const limited = await limitWrite();
  if (limited) return { success: false, error: limited };

  const parsed = processArcoSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const ctx = await getActorContext();
  if (typeof ctx === "string") return { success: false, error: ctx };

  const { allowed } = await can(ctx.actorId, "arco.manage", "view");
  if (!allowed) return { success: false, error: "Sin permiso para gestionar ARCO" };

  // maybeSingle: an id that is not (or no longer) visible is "not found"; a failed read is not.
  const { data: request, error: requestError } = await ctx.supabase
    .from("arco_requests")
    .select("*")
    .eq("id", parsed.data.requestId)
    .maybeSingle();

  if (requestError) return { success: false, error: await safeError("arco.process_read", requestError) };
  if (!request) return { success: false, error: "Solicitud no encontrada" };
  if (request.status === "completed" || request.status === "rejected") {
    return { success: false, error: "Solicitud ya procesada" };
  }

  if (parsed.data.action === "reject") {
    const { error } = await ctx.supabase
      .from("arco_requests")
      .update({
        status: "rejected",
        resolution_notes: parsed.data.resolutionNotes ?? "Rechazada",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", request.id);

    if (error) return { success: false, error: await safeError("arco.processArcoRequest", error) };

    await writeAuditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "arco.request_rejected",
      entity: "arco_requests",
      entityId: request.id,
      diff: { resolutionNotes: parsed.data.resolutionNotes },
    });

    revalidatePath("/admin/arco");
    return { success: true, data: { id: request.id } };
  }

  // ── Approve: handle by type ──
  let exportHash: string | undefined;

  if (request.request_type === "acceso") {
    const { data: exportData, error: exportErr } = await ctx.supabase.rpc(
      "export_user_data",
      { p_user_id: request.subject_id }
    );

    if (exportErr) return { success: false, error: await safeError("arco.processArcoRequest", exportErr) };

    const jsonStr = JSON.stringify(exportData, null, 2);
    exportHash = createHash("sha256").update(jsonStr).digest("hex");

    await writeAuditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "arco.data_exported",
      entity: "users",
      entityId: request.subject_id,
      diff: { exportHash, requestId: request.id },
    });
  }

  if (request.request_type === "cancelacion") {
    const { error: anonErr } = await ctx.supabase.rpc("anonymize_user", {
      p_user_id: request.subject_id,
      p_arco_request_id: request.id,
    });

    if (anonErr) return { success: false, error: await safeError("arco.processArcoRequest", anonErr) };

    await writeAuditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "arco.user_anonymized",
      entity: "users",
      entityId: request.subject_id,
      diff: { requestId: request.id },
    });
  }

  const { error: updateErr } = await ctx.supabase
    .from("arco_requests")
    .update({
      status: "completed",
      resolution_notes: parsed.data.resolutionNotes ?? "Completada",
      export_hash: exportHash ?? null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", request.id);

  if (updateErr) return { success: false, error: await safeError("arco.processArcoRequest", updateErr) };

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: "arco.request_completed",
    entity: "arco_requests",
    entityId: request.id,
    diff: { requestType: request.request_type, exportHash },
  });

  revalidatePath("/admin/arco");
  return { success: true, data: { id: request.id, exportHash } };
}

// ─── Export user data (download JSON) ─────────────────────────

export async function exportUserData(
  subjectId: string
): Promise<ActionResult<{ json: string; hash: string }>> {
  const limited = await limitWrite();
  if (limited) return { success: false, error: limited };

  const valid = uuidSchema.safeParse(subjectId);
  if (!valid.success) return { success: false, error: "ID inválido" };

  const ctx = await getActorContext();
  if (typeof ctx === "string") return { success: false, error: ctx };

  const { allowed } = await can(ctx.actorId, "arco.manage", "view");
  if (!allowed) return { success: false, error: "Sin permiso para gestionar ARCO" };

  const { data, error } = await ctx.supabase.rpc("export_user_data", {
    p_user_id: subjectId,
  });

  if (error) return { success: false, error: await safeError("arco.exportUserData", error) };

  const jsonStr = JSON.stringify(data, null, 2);
  const hash = createHash("sha256").update(jsonStr).digest("hex");

  return { success: true, data: { json: jsonStr, hash } };
}
