// D45: the employee detail shows the current job record. Before, the job query
// asked PostgREST for business_units and legal_entities embeds that
// ec_job_information has no relation to; the query failed and the page said
// "Sin información laboral registrada" for everyone. Business unit and legal
// entity now come from the record's department.
import { expect, test, type Locator } from "@playwright/test";
import { storageStatePath } from "./support/env";
import { PROTECTED_PAGES, openProtected, watchPage, type Role } from "./support/pages";

const detail = PROTECTED_PAGES.find((p) => p.name === "empleado-detalle")!;

/** The value next to a label in a section's first list (the current record, not its history). */
const fieldValue = (section: Locator, label: string) =>
  section.locator("dl").first().locator(":scope > div").filter({ has: section.page().locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");

for (const role of detail.roles as Role[]) {
  test.describe(`detalle de empleado (${role})`, () => {
    test.use({ storageState: async ({}, provide) => provide(storageStatePath(role)) });

    test("Información Laboral muestra el puesto, el departamento, la unidad de negocio y la entidad legal", async ({ page }) => {
      const problems = watchPage(page);
      await openProtected(page, detail.path);

      const job = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Información Laboral" }) });
      await expect(job).toBeVisible();
      await expect(job).not.toContainText("Sin información laboral registrada");
      await expect(page.getByText(/No se pudo cargar/)).toHaveCount(0);
      for (const label of ["Puesto", "Departamento", "Unidad de negocio", "Entidad legal"]) {
        const value = fieldValue(job, label);
        await expect(value, label).toHaveText(/\S/);
        await expect(value, label).not.toHaveText("—");
      }
      expect(problems()).toEqual([]);
    });
  });
}
