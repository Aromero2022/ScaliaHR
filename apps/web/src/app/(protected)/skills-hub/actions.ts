"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { can } from "@/lib/authz/can";
import { writeAuditLog } from "@/lib/audit/log";

type ActionResult = { success: true } | { error: string };

const SelfAssessmentSchema = z.object({
  skillId: z.string().uuid(),
  level: z.coerce.number().int().min(1).max(5),
});

const ManagerAssessmentSchema = z.object({
  userId: z.string().uuid(),
  skillId: z.string().uuid(),
  level: z.coerce.number().int().min(1).max(5),
});

const CreateSkillSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.enum(["technical", "soft", "language"]),
});

const UpdateSkillSchema = z.object({
  skillId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  category: z.enum(["technical", "soft", "language"]).optional(),
  isActive: z.boolean().optional(),
});

const JobRoleSkillSchema = z.object({
  jobRoleId: z.string().uuid(),
  skillId: z.string().uuid(),
  requiredProficiencyLevel: z.coerce.number().int().min(1).max(5),
});

async function getAuthContext() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const { data: bizUser } = await supabase
    .from("users")
    .select("id, tenant_id")
    .eq("auth_uid", authUser.id)
    .single();

  if (!bizUser) return null;

  return { supabase, authUser, bizUser };
}

export async function updateSelfAssessment(
  input: unknown
): Promise<ActionResult> {
  const parsed = SelfAssessmentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getAuthContext();
  if (!ctx) return { error: "No autenticado" };

  const { supabase, bizUser } = ctx;
  const { skillId, level } = parsed.data;

  const perm = await can(bizUser.id, bizUser.tenant_id, "tih.employee_skills", "edit");
  if (!perm.allowed) return { error: "Sin permiso para evaluar habilidades" };

  const { error } = await supabase.rpc("upsert_self_assessment", {
    p_skill_id: skillId,
    p_level: level,
  });

  if (error) return { error: error.message };

  revalidatePath("/skills-hub");
  return { success: true };
}

export async function setManagerAssessment(
  input: unknown
): Promise<ActionResult> {
  const parsed = ManagerAssessmentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getAuthContext();
  if (!ctx) return { error: "No autenticado" };

  const { supabase } = ctx;
  const { userId, skillId, level } = parsed.data;

  const { error } = await supabase.rpc("set_manager_assessment", {
    p_user_id: userId,
    p_skill_id: skillId,
    p_level: level,
  });

  if (error) return { error: error.message };

  revalidatePath("/skills-hub");
  return { success: true };
}

export async function createSkill(input: unknown): Promise<ActionResult> {
  const parsed = CreateSkillSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getAuthContext();
  if (!ctx) return { error: "No autenticado" };

  const { supabase, bizUser } = ctx;

  const perm = await can(bizUser.id, bizUser.tenant_id, "tih.ontology", "edit");
  if (!perm.allowed) return { error: "Sin permiso para gestionar ontología" };

  const { data, error } = await supabase
    .from("skill_ontology")
    .insert({
      tenant_id: bizUser.tenant_id,
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      category: parsed.data.category,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  await writeAuditLog({
    tenantId: bizUser.tenant_id,
    actorId: bizUser.id,
    action: "tih.ontology.create",
    entity: "skill_ontology",
    entityId: data.id,
    diff: { code: parsed.data.code, name: parsed.data.name, category: parsed.data.category },
  });

  revalidatePath("/skills-hub");
  return { success: true };
}

export async function updateSkill(input: unknown): Promise<ActionResult> {
  const parsed = UpdateSkillSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getAuthContext();
  if (!ctx) return { error: "No autenticado" };

  const { supabase, bizUser } = ctx;

  const perm = await can(bizUser.id, bizUser.tenant_id, "tih.ontology", "edit");
  if (!perm.allowed) return { error: "Sin permiso para gestionar ontología" };

  const { skillId, ...updates } = parsed.data;

  const { data: before } = await supabase
    .from("skill_ontology")
    .select("name, description, category, is_active")
    .eq("id", skillId)
    .eq("tenant_id", bizUser.tenant_id)
    .single();

  if (!before) return { error: "Habilidad no encontrada" };

  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.category !== undefined) payload.category = updates.category;
  if (updates.isActive !== undefined) payload.is_active = updates.isActive;

  if (Object.keys(payload).length === 0) return { error: "Sin cambios" };

  const { error } = await supabase
    .from("skill_ontology")
    .update(payload)
    .eq("id", skillId)
    .eq("tenant_id", bizUser.tenant_id);

  if (error) return { error: error.message };

  const diff: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(payload)) {
    const beforeKey = key as keyof typeof before;
    if (before[beforeKey] !== val) {
      diff[key] = { old: before[beforeKey], new: val };
    }
  }

  if (Object.keys(diff).length > 0) {
    await writeAuditLog({
      tenantId: bizUser.tenant_id,
      actorId: bizUser.id,
      action: "tih.ontology.update",
      entity: "skill_ontology",
      entityId: skillId,
      diff,
    });
  }

  revalidatePath("/skills-hub");
  return { success: true };
}

export async function updateJobRoleSkill(
  input: unknown
): Promise<ActionResult> {
  const parsed = JobRoleSkillSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getAuthContext();
  if (!ctx) return { error: "No autenticado" };

  const { supabase, bizUser } = ctx;

  const perm = await can(bizUser.id, bizUser.tenant_id, "tih.job_requirements", "edit");
  if (!perm.allowed)
    return { error: "Sin permiso para gestionar requisitos de puesto" };

  const { jobRoleId, skillId, requiredProficiencyLevel } = parsed.data;

  const { data: existing } = await supabase
    .from("job_role_skills")
    .select("required_proficiency_level")
    .eq("tenant_id", bizUser.tenant_id)
    .eq("job_role_id", jobRoleId)
    .eq("skill_id", skillId)
    .maybeSingle();

  const oldLevel = existing?.required_proficiency_level ?? null;

  const { error } = await supabase.from("job_role_skills").upsert(
    {
      tenant_id: bizUser.tenant_id,
      job_role_id: jobRoleId,
      skill_id: skillId,
      required_proficiency_level: requiredProficiencyLevel,
    },
    { onConflict: "tenant_id,job_role_id,skill_id" }
  );

  if (error) return { error: error.message };

  await writeAuditLog({
    tenantId: bizUser.tenant_id,
    actorId: bizUser.id,
    action: "tih.job_requirements.upsert",
    entity: "job_role_skills",
    entityId: `${jobRoleId}:${skillId}`,
    diff: { old_level: oldLevel, new_level: requiredProficiencyLevel },
  });

  revalidatePath("/skills-hub");
  return { success: true };
}
