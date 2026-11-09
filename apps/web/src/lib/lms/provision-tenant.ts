import { createClient } from "@/lib/supabase/server";
import * as moodle from "@/lib/lms/moodle-client";

export async function provisionTenantLms(tenantId: string, tenantName: string) {
  const supabase = await createClient();

  // D45: maybeSingle: no map yet means "provision it"; a failed read must not
  // be taken for that, or the tenant gets a second category and cohort.
  const { data: existing, error: existingError } = await supabase
    .from("lms_tenant_map")
    .select("id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to read LMS tenant map: ${existingError.message}`);
  }
  if (existing) {
    return { alreadyProvisioned: true };
  }

  const category = await moodle.createCategory(`${tenantName} — Formación`);
  const cohort = await moodle.createCohort(
    `${tenantName} — Empleados`,
    `tenant_${tenantId}`
  );

  const { error } = await supabase.from("lms_tenant_map").insert({
    tenant_id: tenantId,
    moodle_category_id: category.id,
    moodle_cohort_id: cohort.id,
  });

  if (error) {
    throw new Error(`Failed to store LMS tenant map: ${error.message}`);
  }

  return {
    alreadyProvisioned: false,
    categoryId: category.id,
    cohortId: cohort.id,
  };
}
