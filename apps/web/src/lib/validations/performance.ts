import { z } from "zod";

// D31: the performance forms arrive as FormData; every field is checked here
// before anything reaches the database. Empty optional fields become null.

const isoDate = (message: string) => z.iso.date(message);
const optionalText = (max: number) =>
  z.string().trim().max(max, `Máximo ${max} caracteres`).optional().transform((v) => v || null);
const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

export const CreateGoalSchema = z
  .object({
    title: z.string().trim().min(1, "El título es obligatorio").max(200, "Máximo 200 caracteres"),
    description: optionalText(2000),
    metric: optionalText(200),
    target_value: z.preprocess(blankToUndefined, z.coerce.number("Valor objetivo inválido").optional()).transform((v) => v ?? null),
    weight: z.preprocess(blankToUndefined, z.coerce.number("Peso inválido").min(0, "El peso va de 0 a 1").max(1, "El peso va de 0 a 1").default(0)),
    due_date: z.preprocess(blankToUndefined, isoDate("Fecha límite inválida").optional()).transform((v) => v ?? null),
    period_start: isoDate("La fecha de inicio es obligatoria"),
    period_end: isoDate("La fecha de fin es obligatoria"),
  })
  .refine((goal) => goal.period_end >= goal.period_start, {
    message: "La fecha de fin no puede ser anterior a la de inicio",
    path: ["period_end"],
  });

export const SendFeedbackSchema = z.object({
  subject_id: z.guid("Destinatario inválido"),
  content: z.string().trim().min(1, "El contenido es obligatorio").max(5000, "Máximo 5000 caracteres"),
  visibility: z.preprocess(blankToUndefined, z.enum(["PRIVATE", "MANAGER_ONLY", "PUBLIC"], "Visibilidad inválida").default("PRIVATE")),
  category: z.preprocess(
    blankToUndefined,
    z.enum(["GENERAL", "RECOGNITION", "COACHING", "DEVELOPMENT"], "Categoría inválida").default("GENERAL"),
  ),
});

/** The fields of a form as a plain object; anything that is not FormData passes through for zod to reject. */
export function formFields(input: unknown): unknown {
  return input instanceof FormData ? Object.fromEntries(input) : input;
}
