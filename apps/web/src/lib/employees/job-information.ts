/**
 * D45: what the employee detail reads of a job record. Business unit and legal
 * entity are not columns of ec_job_information (PostgREST answered PGRST200 to
 * the old `business_units(name), legal_entities(name)` embed and the page showed
 * "Sin información laboral registrada"): they come from the record's department.
 * Whether they move into the job record, as in SuccessFactors, is decided in
 * Fase 14 (ROADMAP).
 */
export const JOB_INFORMATION_SELECT =
  "*, positions(title, position_code), departments(name, business_units(name), legal_entities(name)), job_classifications(title), locations(name)";

type Named = { name: string | null } | null;

/** The department of a job record read with JOB_INFORMATION_SELECT, and its business unit and legal entity. */
export function jobOrganization(record: { departments?: unknown }): {
  department: string | null;
  businessUnit: string | null;
  legalEntity: string | null;
} {
  const department = one(record.departments) as { name: string | null; business_units: unknown; legal_entities: unknown } | null;
  return {
    department: department?.name ?? null,
    businessUnit: (one(department?.business_units) as Named)?.name ?? null,
    legalEntity: (one(department?.legal_entities) as Named)?.name ?? null,
  };
}

/** A to-one embed: PostgREST returns an object, older typings an array of one. */
function one(value: unknown): unknown {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
