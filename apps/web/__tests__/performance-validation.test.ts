import { describe, expect, it } from "vitest";
import { CreateGoalSchema, SendFeedbackSchema, formFields } from "@/lib/validations/performance";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return formFields(fd);
}

const goal = { title: "  Reducir rotación ", period_start: "2026-01-01", period_end: "2026-06-30" };

describe("CreateGoalSchema (D31)", () => {
  it("accepts the form with empty optional fields as null and weight 0", () => {
    expect(CreateGoalSchema.parse(form({ ...goal, description: "", metric: "", target_value: "", weight: "", due_date: "" }))).toEqual({
      title: "Reducir rotación",
      description: null,
      metric: null,
      target_value: null,
      weight: 0,
      due_date: null,
      period_start: "2026-01-01",
      period_end: "2026-06-30",
    });
  });

  it("reads numbers and dates", () => {
    const parsed = CreateGoalSchema.parse(form({ ...goal, target_value: "12.5", weight: "0.25", due_date: "2026-05-01" }));
    expect(parsed).toMatchObject({ target_value: 12.5, weight: 0.25, due_date: "2026-05-01" });
  });

  it.each([
    [{ ...goal, title: " " }, "El título es obligatorio"],
    [{ ...goal, period_start: "" }, "La fecha de inicio es obligatoria"],
    [{ ...goal, period_end: "30/06/2026" }, "La fecha de fin es obligatoria"],
    [{ ...goal, period_end: "2025-12-31" }, "La fecha de fin no puede ser anterior a la de inicio"],
    [{ ...goal, weight: "1.5" }, "El peso va de 0 a 1"],
    [{ ...goal, target_value: "mucho" }, "Valor objetivo inválido"],
    [{ ...goal, title: "x".repeat(201) }, "Máximo 200 caracteres"],
  ])("rejects %o", (fields, message) => {
    const result = CreateGoalSchema.safeParse(form(fields));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(message);
  });

  it("rejects input that is not a form", () => {
    expect(CreateGoalSchema.safeParse(formFields("title=x")).success).toBe(false);
    expect(CreateGoalSchema.safeParse(formFields(null)).success).toBe(false);
  });
});

describe("SendFeedbackSchema (D31)", () => {
  const subject = "e0000000-0000-0000-0000-000000000001";

  it("defaults visibility and category", () => {
    expect(SendFeedbackSchema.parse(form({ subject_id: subject, content: " Buen trabajo ", visibility: "", category: "" }))).toEqual({
      subject_id: subject,
      content: "Buen trabajo",
      visibility: "PRIVATE",
      category: "GENERAL",
    });
  });

  it.each([
    [{ subject_id: "1 OR 1=1", content: "x" }, "Destinatario inválido"],
    [{ subject_id: subject, content: "  " }, "El contenido es obligatorio"],
    [{ subject_id: subject, content: "x", visibility: "EVERYONE" }, "Visibilidad inválida"],
    [{ subject_id: subject, content: "x", category: "GOSSIP" }, "Categoría inválida"],
  ])("rejects %o", (fields, message) => {
    expect(SendFeedbackSchema.safeParse(form(fields)).error?.issues[0].message).toBe(message);
  });
});
