"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit/log";
import { can } from "@/lib/authz/can";
import { safeError } from "@/lib/errors/safe-error";
import { limitRead, limitWrite } from "@/lib/rate-limit";
import { firstError } from "@/lib/errors/query-error";
import { messages } from "@/lib/i18n/es-MX";

// D46: guid, not uuid. The seed's ids (e0000000-…, 5c000000-…, aa100000-…) are
// not RFC 4122, and z.uuid() refused them, so nothing could be saved on demo data.
const idSchema = z.guid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido");

type ActionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

/** The actor of the action, or the message to return (D45: a failed read is not "No autenticado"). */
async function getActorContext() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return "No autenticado";

  const { data: profile, error } = await supabase
    .from("users")
    .select("id, tenant_id")
    .eq("auth_uid", authUser.id)
    .maybeSingle();

  if (error) return await safeError("ec.actor", error);
  if (!profile) return "No autenticado";

  return { supabase, actorId: profile.id, tenantId: profile.tenant_id };
}

// ─── "Tomar Acción" options ────────────────────────────────────────

type SelectOption = { id: string; label: string };

export type ActionOptions = {
  positions: SelectOption[];
  departments: SelectOption[];
  jobClassifications: SelectOption[];
  managers: SelectOption[];
  locations: SelectOption[];
  employeeName: string;
};

const actionOptionsSchema = z.object({ employeeId: idSchema });

/**
 * D45: the lists of the "Tomar Acción" dialog, read on the server under the
 * caller's RLS. Before, the browser read them itself and a failed list showed
 * as an empty select; now any failure is a safe error (request id) and the
 * dialog does not let the form be sent.
 */
export async function loadActionOptions(input: z.input<typeof actionOptionsSchema>): Promise<ActionResult<ActionOptions>> {
  const limited = await limitRead();
  if (limited) return { success: false, error: limited };

  const parsed = actionOptionsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  const ctx = await getActorContext();
  if (typeof ctx === "string") return { success: false, error: ctx };

  const { allowed } = await can(ctx.actorId, "ec.manage_employees", "edit", parsed.data.employeeId);
  if (!allowed) return { success: false, error: "Sin permiso para gestionar empleados" };

  const { supabase } = ctx;
  const [posRes, deptRes, jcRes, mgrRes, locRes, empRes] = await Promise.all([
    supabase.from("positions").select("id, title, position_code").order("title"),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("job_classifications").select("id, title").order("title"),
    supabase.from("users").select("id, first_name, last_name").eq("status", "ACTIVE").is("deleted_at", null).order("last_name"),
    supabase.from("locations").select("id, name").order("name"),
    // maybeSingle: an employee the caller cannot see is "not found", not a failure.
    supabase.from("users").select("first_name, last_name").eq("id", parsed.data.employeeId).maybeSingle(),
  ]);

  const error = firstError(posRes.error, deptRes.error, jcRes.error, mgrRes.error, locRes.error, empRes.error);
  if (error) return { success: false, error: await safeError("ec.action_options", error, messages.common.sectionLoadError) };
  if (!empRes.data) return { success: false, error: "Empleado no encontrado" };

  return {
    success: true,
    data: {
      positions: (posRes.data ?? []).map((p) => ({ id: p.id, label: `${p.title} (${p.position_code})` })),
      departments: (deptRes.data ?? []).map((d) => ({ id: d.id, label: d.name })),
      jobClassifications: (jcRes.data ?? []).map((j) => ({ id: j.id, label: j.title })),
      managers: (mgrRes.data ?? []).map((m) => ({ id: m.id, label: `${m.first_name} ${m.last_name}` })),
      locations: (locRes.data ?? []).map((l) => ({ id: l.id, label: l.name })),
      employeeName: `${empRes.data.first_name} ${empRes.data.last_name}`,
    },
  };
}

// ─── Job Change ────────────────────────────────────────────────────

const jobChangeSchema = z.object({
  userId: idSchema,
  startDate: dateSchema,
  jobTitle: z.string().min(1, "Título de puesto requerido"),
  positionId: idSchema.optional(),
  departmentId: idSchema.optional(),
  jobClassificationId: idSchema.optional(),
  managerId: idSchema.optional(),
  locationId: idSchema.optional(),
  eventReason: z.string().min(1, "Motivo requerido"),
});

export async function createJobChange(
  input: z.input<typeof jobChangeSchema>
): Promise<ActionResult<{ id: string }>> {
  const limited = await limitWrite();
  if (limited) return { success: false, error: limited };

  const parsed = jobChangeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const ctx = await getActorContext();
  if (typeof ctx === "string") return { success: false, error: ctx };

  const { allowed } = await can(ctx.actorId, "ec.manage_employees", "edit", parsed.data.userId);
  if (!allowed) return { success: false, error: "Sin permiso para gestionar empleados" };

  const { userId, startDate, eventReason, jobTitle, ...optionalFields } = parsed.data;

  const recordData: Record<string, unknown> = { job_title: jobTitle, event_reason: eventReason };
  if (optionalFields.positionId) recordData.position_id = optionalFields.positionId;
  if (optionalFields.departmentId) recordData.department_id = optionalFields.departmentId;
  if (optionalFields.jobClassificationId) recordData.job_classification_id = optionalFields.jobClassificationId;
  if (optionalFields.managerId) recordData.manager_id = optionalFields.managerId;
  if (optionalFields.locationId) recordData.location_id = optionalFields.locationId;

  const { data, error } = await ctx.supabase.rpc("insert_effective_record", {
    p_table: "ec_job_information",
    p_user_id: userId,
    p_data: recordData,
    p_start: startDate,
  });

  if (error) {
    return { success: false, error: await safeError("ec.job_change", error) };
  }

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: "ec.job_change",
    entity: "ec_job_information",
    entityId: data as string,
    diff: { userId, startDate, jobTitle, ...optionalFields, eventReason },
  });

  revalidatePath(`/employees/${userId}`);
  return { success: true, data: { id: data as string } };
}

// ─── Compensation Change ───────────────────────────────────────────

const compensationSchema = z.object({
  userId: idSchema,
  startDate: dateSchema,
  baseSalary: z.number().positive("Salario debe ser positivo"),
  currency: z.enum(["MXN", "USD"]).default("MXN"),
  payFrequency: z.enum(["monthly", "biweekly", "weekly", "annual"]).default("monthly"),
  bonusTargetPct: z.number().min(0).max(100).optional(),
  payGroup: z.string().optional(),
  eventReason: z.string().min(1, "Motivo requerido"),
});

export async function createCompensationChange(
  input: z.input<typeof compensationSchema>
): Promise<ActionResult<{ id: string }>> {
  const limited = await limitWrite();
  if (limited) return { success: false, error: limited };

  const parsed = compensationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const ctx = await getActorContext();
  if (typeof ctx === "string") return { success: false, error: ctx };

  const { allowed } = await can(ctx.actorId, "ec.manage_employees", "edit", parsed.data.userId);
  if (!allowed) return { success: false, error: "Sin permiso para gestionar empleados" };

  const { userId, startDate, baseSalary, currency, payFrequency, bonusTargetPct, payGroup, eventReason } = parsed.data;

  const recordData: Record<string, unknown> = {
    base_salary: baseSalary,
    currency,
    frequency: payFrequency,
    event_reason: eventReason,
  };
  if (bonusTargetPct !== undefined) recordData.bonus_target = bonusTargetPct;
  if (payGroup) recordData.pay_group = payGroup;

  const { data, error } = await ctx.supabase.rpc("insert_effective_record", {
    p_table: "ec_compensation",
    p_user_id: userId,
    p_data: recordData,
    p_start: startDate,
  });

  if (error) {
    return { success: false, error: await safeError("ec.comp_change", error) };
  }

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: "ec.comp_change",
    entity: "ec_compensation",
    entityId: data as string,
    diff: { userId, startDate, baseSalary, currency, payFrequency, bonusTargetPct, eventReason },
  });

  revalidatePath(`/employees/${userId}`);
  return { success: true, data: { id: data as string } };
}

// ─── Personal Information Change ───────────────────────────────────

const personalInfoSchema = z.object({
  userId: idSchema,
  startDate: dateSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  middleName: z.string().optional(),
  dateOfBirth: dateSchema.optional(),
  gender: z.string().optional(),
  maritalStatus: z.string().optional(),
  nationality: z.string().optional(),
  nationalId: z.string().optional(),
  taxId: z.string().optional(),
  phone: z.string().optional(),
  personalEmail: z.string().email().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().default("MX"),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  eventReason: z.string().min(1, "Motivo requerido"),
});

export async function createPersonalInfoChange(
  input: z.input<typeof personalInfoSchema>
): Promise<ActionResult<{ id: string }>> {
  const limited = await limitWrite();
  if (limited) return { success: false, error: limited };

  const parsed = personalInfoSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const ctx = await getActorContext();
  if (typeof ctx === "string") return { success: false, error: ctx };

  const { allowed } = await can(ctx.actorId, "ec.manage_employees", "edit", parsed.data.userId);
  if (!allowed) return { success: false, error: "Sin permiso para gestionar empleados" };

  const { userId, startDate, eventReason, ...fields } = parsed.data;

  const recordData: Record<string, unknown> = {
    first_name: fields.firstName,
    last_name: fields.lastName,
    event_reason: eventReason,
  };

  const optionalMap: Record<string, string> = {
    middleName: "middle_name",
    dateOfBirth: "date_of_birth",
    gender: "gender",
    maritalStatus: "marital_status",
    nationality: "nationality",
    nationalId: "national_id",
    taxId: "tax_id",
    phone: "phone",
    personalEmail: "personal_email",
    addressLine1: "address_line1",
    addressLine2: "address_line2",
    city: "city",
    state: "state",
    postalCode: "postal_code",
    country: "country",
    emergencyContactName: "emergency_contact_name",
    emergencyContactPhone: "emergency_contact_phone",
  };

  for (const [jsKey, dbKey] of Object.entries(optionalMap)) {
    const val = fields[jsKey as keyof typeof fields];
    if (val !== undefined && val !== "") {
      recordData[dbKey] = val;
    }
  }

  const { data, error } = await ctx.supabase.rpc("insert_effective_record", {
    p_table: "ec_personal_information",
    p_user_id: userId,
    p_data: recordData,
    p_start: startDate,
  });

  if (error) {
    return { success: false, error: await safeError("ec.personal_change", error) };
  }

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: "ec.personal_change",
    entity: "ec_personal_information",
    entityId: data as string,
    diff: { userId, startDate, ...fields, eventReason },
  });

  revalidatePath(`/employees/${userId}`);
  return { success: true, data: { id: data as string } };
}
