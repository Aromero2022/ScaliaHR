import { createClient } from "@/lib/supabase/server";
import * as moodle from "@/lib/lms/moodle-client";

export async function provisionTenantLms(tenantId: string, tenantName: string) {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("lms_tenant_map")
    .select("id")
    .eq("tenant_id", tenantId)
    .single();

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
