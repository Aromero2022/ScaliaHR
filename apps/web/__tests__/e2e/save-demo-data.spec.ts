// D46: saving on the seed's data. The Server Actions validated ids with
// z.uuid(), which refuses the seed's ids (e0000000-…, 5c000000-…): on demo data
// "Tomar Acción" and "Evaluar" answered "Invalid UUID" and saved nothing. Both
// now save. What they save is marked, and scripts/e2e-accounts.mjs undoes it
// after the run; the job change keeps the title and department, so no other
// screen of the run changes.
import { expect, test, type Locator } from "@playwright/test";
import { e2eAccounts, storageStatePath } from "./support/env";
import { openProtected, watchPage } from "./support/pages";

/** The value next to a label in a section's first list (the current record, not its history). */
const fieldValue = (section: Locator, label: string) =>
  section.locator("dl").first().locator(":scope > div").filter({ has: section.page().locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");

test.describe("guardar con datos demo (admin)", () => {
  test.use({ storageState: async ({}, provide) => provide(storageStatePath("admin")) });

  test("Tomar Acción registra un cambio de puesto de una empleada del seed", async ({ page }) => {
    const { demo } = e2eAccounts();
    const problems = watchPage(page);
    const detail = `/employees/${demo.jobChangeEmployeeId}`;
    await openProtected(page, detail);
    const job = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Información Laboral" }) });
    const title = (await fieldValue(job, "Puesto").textContent())?.trim() ?? "";
    const department = (await fieldValue(job, "Departamento").textContent())?.trim() ?? "";
    expect(title, "the employee has a current title").not.toBe("—");

    await page.getByRole("button", { name: "Tomar Acción" }).click();
    await page.getByRole("menuitem", { name: "Cambio de puesto" }).click();
    // 9c PR 6a: the menu opens the dialog on the chosen form.
    const dialog = page.getByRole("dialog", { name: /^Cambio de puesto — / });
    await dialog.getByLabel("Título del Puesto").fill(title);
    await dialog.getByLabel("Departamento").selectOption({ label: department });
    await dialog.getByLabel("Motivo").fill(demo.reason);
    await dialog.getByRole("button", { name: "Registrar Cambio" }).click();
    await expect(dialog.getByText("Cambio de puesto registrado")).toBeVisible();

    await openProtected(page, detail);
    await expect(fieldValue(job, "Motivo")).toHaveText(demo.reason);
    await expect(fieldValue(job, "Puesto")).toHaveText(title);
    await expect(fieldValue(job, "Departamento")).toHaveText(department);
    expect(problems()).toEqual([]);
  });
});

test.describe("guardar con datos demo (empleada)", () => {
  test.use({ storageState: async ({}, provide) => provide(storageStatePath("empleada")) });

  test("Evaluar guarda la autoevaluación de una habilidad con id del seed", async ({ page }) => {
    const { demo } = e2eAccounts();
    const problems = watchPage(page);
    const card = () =>
      page.getByRole("heading", { level: 3, name: demo.skillName }).locator("xpath=ancestor::div[contains(@class, 'rounded-xl')][1]");

    await openProtected(page, "/skills-hub");
    await page.getByRole("button", { name: "Catálogo de Habilidades" }).click();
    await expect(card()).toContainText("Sin evaluar");
    await card().getByRole("button", { name: "Evaluar" }).click();
    await card().getByRole("button", { name: "3", exact: true }).click();
    await expect(card()).toContainText("Tu nivel: 3/5");

    await openProtected(page, "/skills-hub");
    await page.getByRole("button", { name: "Catálogo de Habilidades" }).click();
    await expect(card()).toContainText("Tu nivel: 3/5");
    expect(problems()).toEqual([]);
  });
});
