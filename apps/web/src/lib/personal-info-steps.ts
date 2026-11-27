import { messages } from "@/lib/i18n/es-MX";

// 9c PR 6d (D51): the steps of "Actualizar información personal". The client
// uses them to show one step at a time; the Server Action validates the whole
// object and returns its errors by field, and firstStepWithError() takes the
// form back to the first step that has one. No zod here: the client bundle
// does not carry the schema.

export const PERSONAL_INFO_FIELDS = [
  "startDate",
  "firstName",
  "middleName",
  "lastName",
  "phone",
  "personalEmail",
  "emergencyContactName",
  "emergencyContactPhone",
  "addressLine1",
  "city",
  "state",
  "postalCode",
  "country",
  "eventReason",
] as const;

export type PersonalInfoField = (typeof PERSONAL_INFO_FIELDS)[number];
export type PersonalInfoFieldErrors = Partial<Record<PersonalInfoField, string>>;

export interface PersonalInfoStep {
  id: string;
  title: string;
  fields: readonly PersonalInfoField[];
}

const t = messages.personalInfoForm;

export const PERSONAL_INFO_STEPS: readonly PersonalInfoStep[] = [
  { id: "nombre", title: t.steps.name, fields: ["startDate", "firstName", "middleName", "lastName"] },
  { id: "contacto", title: t.steps.contact, fields: ["phone", "personalEmail", "emergencyContactName", "emergencyContactPhone"] },
  { id: "domicilio", title: t.steps.address, fields: ["addressLine1", "city", "state", "postalCode", "country", "eventReason"] },
];

export function isPersonalInfoField(key: string): key is PersonalInfoField {
  return (PERSONAL_INFO_FIELDS as readonly string[]).includes(key);
}

/** The index of the first step with an error, or null when no field of a step has one. */
export function firstStepWithError(errors: PersonalInfoFieldErrors): number | null {
  const index = PERSONAL_INFO_STEPS.findIndex((step) => step.fields.some((field) => errors[field]));
  return index === -1 ? null : index;
}
