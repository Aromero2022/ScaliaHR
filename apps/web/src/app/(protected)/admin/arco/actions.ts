"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit/log";
import { can } from "@/lib/authz/can";
import { createHash } from "crypto";

const uuidSchema = z.string().uuid();

type ActionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

async function getActorContext() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("id, tenant_id")
    .eq("auth_uid", authUser.id)
    .single();

  if (!profile) return null;

  return { supabase, actorId: profile.id, tenantId: profile.tenant_id };
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
  const parsed = createArcoSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const ctx = await getActorContext();
  if (!ctx) return { success: false, error: "No autenticado" };

  const { allowed } = await can(ctx.actorId, ctx.tenantId, "arco.manage", "view");
  if (!allowed) return { success: false, error: "Sin permiso para gestionar ARCO" };

  const { data: dueDate } = await ctx.supabase.rpc("compute_arco_due_date");

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
    console.error("[arco.create]", error.message);
    return { success: false, error: error.message };
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
  const parsed = processArcoSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const ctx = await getActorContext();
  if (!ctx) return { success: false, error: "No autenticado" };

  const { allowed } = await can(ctx.actorId, ctx.tenantId, "arco.manage", "view");
  if (!allowed) return { success: false, error: "Sin permiso para gestionar ARCO" };

  const { data: request } = await ctx.supabase
    .from("arco_requests")
    .select("*")
    .eq("id", parsed.data.requestId)
    .single();

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

    if (error) return { success: false, error: error.message };

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

    if (exportErr) return { success: false, error: exportErr.message };

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

    if (anonErr) return { success: false, error: anonErr.message };

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

  if (updateErr) return { success: false, error: updateErr.message };

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
  const valid = uuidSchema.safeParse(subjectId);
  if (!valid.success) return { success: false, error: "ID inválido" };

  const ctx = await getActorContext();
  if (!ctx) return { success: false, error: "No autenticado" };

  const { allowed } = await can(ctx.actorId, ctx.tenantId, "arco.manage", "view");
  if (!allowed) return { success: false, error: "Sin permiso para gestionar ARCO" };

  const { data, error } = await ctx.supabase.rpc("export_user_data", {
    p_user_id: subjectId,
  });

  if (error) return { success: false, error: error.message };

  const jsonStr = JSON.stringify(data, null, 2);
  const hash = createHash("sha256").update(jsonStr).digest("hex");

  return { success: true, data: { json: jsonStr, hash } };
}
