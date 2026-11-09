"use server";

import { createClient } from "@/lib/supabase/server";
import { getClaims } from "@/lib/supabase/claims";
import { revalidatePath } from "next/cache";
import { can } from "@/lib/authz/can";
import { safeError } from "@/lib/errors/safe-error";
import { limitWrite } from "@/lib/rate-limit";
import { currentUserOrError } from "@/lib/auth/current-user";
import { CreateGoalSchema, SendFeedbackSchema, formFields } from "@/lib/validations/performance";

export async function createGoal(formData: FormData) {
  const limited = await limitWrite();
  if (limited) return { error: limited };

  const parsed = CreateGoalSchema.safeParse(formFields(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const claims = await getClaims();
  if (!claims?.tenantId) return { error: "No autenticado" };

  const supabase = await createClient();
  // D45: a failed read of the employee row returns its safe error, not "not found".
  const { user: bizUser, error: userError } = await currentUserOrError();
  if (userError) return { error: userError };
  if (!bizUser) return { error: "Usuario no encontrado" };

  const { allowed } = await can(bizUser.id, "pmgm.view_own_goals", "edit");
  if (!allowed) return { error: "Sin permiso para crear objetivos" };

  const goal = parsed.data;

  const { error } = await supabase.from("performance_goals").insert({
    tenant_id: claims.tenantId,
    user_id: bizUser.id,
    title: goal.title,
    description: goal.description,
    metric: goal.metric,
    target_value: goal.target_value,
    weight: goal.weight,
    status: "NOT_STARTED",
    due_date: goal.due_date,
    progress_percentage: 0,
    period_start: goal.period_start,
    period_end: goal.period_end,
  });

  if (error) return { error: await safeError("performance.createGoal", error) };

  revalidatePath("/performance");
  return { success: true };
}

export async function sendFeedback(formData: FormData) {
  const limited = await limitWrite();
  if (limited) return { error: limited };

  const parsed = SendFeedbackSchema.safeParse(formFields(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const claims = await getClaims();
  if (!claims?.tenantId) return { error: "No autenticado" };

  const supabase = await createClient();
  // D45: a failed read of the employee row returns its safe error, not "not found".
  const { user: bizUser, error: userError } = await currentUserOrError();
  if (userError) return { error: userError };
  if (!bizUser) return { error: "Usuario no encontrado" };

  const { allowed } = await can(bizUser.id, "pmgm.give_feedback", "edit");
  if (!allowed) return { error: "Sin permiso para enviar feedback" };

  const { subject_id, content, visibility, category } = parsed.data;

  const { error } = await supabase.from("continuous_feedbacks").insert({
    tenant_id: claims.tenantId,
    author_id: bizUser.id,
    subject_id,
    content,
    visibility,
    category,
  });

  if (error) return { error: await safeError("performance.sendFeedback", error) };

  revalidatePath("/performance");
  return { success: true };
}
