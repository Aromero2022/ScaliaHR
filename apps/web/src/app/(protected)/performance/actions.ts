"use server";

import { createClient } from "@/lib/supabase/server";
import { getClaims } from "@/lib/supabase/claims";
import { revalidatePath } from "next/cache";
import { can } from "@/lib/authz/can";

export async function createGoal(formData: FormData) {
  const claims = await getClaims();
  if (!claims?.tenantId) return { error: "No autenticado" };

  const supabase = await createClient();
  const { data: bizUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_uid", claims.userId)
    .single();

  if (!bizUser) return { error: "Usuario no encontrado" };

  const { allowed } = await can(bizUser.id, "pmgm.view_own_goals", "edit");
  if (!allowed) return { error: "Sin permiso para crear objetivos" };

  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const metric = formData.get("metric") as string;
  const targetValue = parseFloat(formData.get("target_value") as string) || null;
  const dueDate = formData.get("due_date") as string;
  const weight = parseFloat(formData.get("weight") as string) || 0;
  const periodStart = formData.get("period_start") as string;
  const periodEnd = formData.get("period_end") as string;

  if (!title || !periodStart || !periodEnd) {
    return { error: "Título, fecha inicio y fecha fin son obligatorios" };
  }

  const { error } = await supabase.from("performance_goals").insert({
    tenant_id: claims.tenantId,
    user_id: bizUser.id,
    title,
    description: description || null,
    metric: metric || null,
    target_value: targetValue,
    weight,
    status: "NOT_STARTED",
    due_date: dueDate || null,
    progress_percentage: 0,
    period_start: periodStart,
    period_end: periodEnd,
  });

  if (error) return { error: error.message };

  revalidatePath("/performance");
  return { success: true };
}

export async function sendFeedback(formData: FormData) {
  const claims = await getClaims();
  if (!claims?.tenantId) return { error: "No autenticado" };

  const supabase = await createClient();
  const { data: bizUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_uid", claims.userId)
    .single();

  if (!bizUser) return { error: "Usuario no encontrado" };

  const { allowed } = await can(bizUser.id, "pmgm.give_feedback", "edit");
  if (!allowed) return { error: "Sin permiso para enviar feedback" };

  const subjectId = formData.get("subject_id") as string;
  const content = formData.get("content") as string;
  const visibility = formData.get("visibility") as string;
  const category = formData.get("category") as string;

  if (!subjectId || !content) {
    return { error: "Destinatario y contenido son obligatorios" };
  }

  const { error } = await supabase.from("continuous_feedbacks").insert({
    tenant_id: claims.tenantId,
    author_id: bizUser.id,
    subject_id: subjectId,
    content,
    visibility: visibility || "PRIVATE",
    category: category || "GENERAL",
  });

  if (error) return { error: error.message };

  revalidatePath("/performance");
  return { success: true };
}
