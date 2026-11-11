// 9c PR 6b: PersonSearch as an ARIA 1.2 combobox (in the feedback dialog) and
// the ⌘K search, with the keyboard alone, in the production image.
import { expect, test, type Page } from "@playwright/test";
import { expectNoWcagViolations } from "./support/axe";
import { storageStatePath } from "./support/env";
import { openProtected, watchPage } from "./support/pages";

async function openFeedbackDialog(page: Page) {
  await openProtected(page, "/performance");
  await page.getByRole("button", { name: /^Feedback Continuo/ }).click();
  await page.getByRole("button", { name: "+ Enviar Feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Enviar Feedback" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("PersonSearch como combobox (empleada)", () => {
  test.use({ storageState: async ({}, provide) => provide(storageStatePath("empleada")) });

  test("se recorre con el teclado, anuncia los resultados y Esc cierra primero la lista", async ({ page }) => {
    const problems = watchPage(page);
    const dialog = await openFeedbackDialog(page);
    const input = dialog.getByRole("combobox", { name: "Buscar destinatario" });
    const listbox = dialog.getByRole("listbox");

    await expect(input).toHaveAttribute("aria-expanded", "false");
    expect((await input.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(input).toHaveAttribute("aria-controls", (await dialog.locator("[role=listbox]").getAttribute("id")) ?? "missing id");

    await input.focus();
    await page.keyboard.type("Patricia");
    await expect(listbox).toBeVisible();
    await expect(input).toHaveAttribute("aria-expanded", "true");
    const option = listbox.getByRole("option", { name: "Patricia Castro" });
    await expect(option).toBeVisible();
    expect((await option.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    // The polite region reads the count once the typing settles.
    await expect(dialog.locator("[aria-live=polite]")).toHaveText(/^\d+ personas? encontradas?$/);

    // Down makes the first option active without moving the focus off the input.
    await page.keyboard.press("ArrowDown");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-activedescendant", (await listbox.getByRole("option").first().getAttribute("id")) ?? "missing id");
    await expect(listbox.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await expectNoWcagViolations(page, "personsearch con resultados");

    // Esc closes the list and leaves the dialog open; a second Esc would close the dialog.
    await page.keyboard.press("Escape");
    await expect(listbox).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(input).toHaveAttribute("aria-expanded", "false");

    // Down opens it again; Enter picks the active person and the focus goes to "Cambiar".
    await page.keyboard.press("ArrowDown");
    await expect(listbox).toBeVisible();
    await page.keyboard.press("Enter");
    const change = dialog.getByRole("button", { name: /^Cambiar Patricia Castro/ });
    await expect(change).toBeFocused();
    expect((await change.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await dialog.locator('input[type="hidden"][name="subject_id"]').inputValue()).not.toBe("");
    await expect(dialog).toBeVisible();

    // "Cambiar" brings the search back with the focus on it.
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("combobox", { name: "Buscar destinatario" })).toBeFocused();
    expect(problems()).toEqual([]);
  });

  test("un 429 de /api/colleagues muestra el mensaje seguro, no «sin resultados»", async ({ page }) => {
    const dialog = await openFeedbackDialog(page);
    await page.route("**/api/colleagues?**", (route) =>
      route.fulfill({ status: 429, headers: { "Retry-After": "30", "Content-Type": "application/json" }, body: '{"error":"too_many_requests"}' }),
    );
    await dialog.getByRole("combobox", { name: "Buscar destinatario" }).fill("Patricia");
    await expect(dialog.getByText("Demasiados intentos. Intenta de nuevo en 30 segundos.")).toBeVisible();
    await expect(dialog.getByText("No se encontraron personas.")).toHaveCount(0);
    await expect(dialog.locator("[aria-live=polite]")).toHaveText("Demasiados intentos. Intenta de nuevo en 30 segundos.");
  });
});

for (const role of ["empleada", "admin"] as const) {
  test.describe(`⌘K (${role})`, () => {
    test.use({ storageState: async ({}, provide) => provide(storageStatePath(role)) });

    test("Ctrl+K abre la búsqueda; se elige un destino con el teclado", async ({ page }) => {
      const problems = watchPage(page);
      await openProtected(page, "/dashboard");
      await page.keyboard.press("Control+k");
      const dialog = page.getByRole("dialog", { name: "Buscar personas y secciones" });
      await expect(dialog).toBeVisible();
      const input = dialog.getByRole("combobox", { name: "Buscar personas y secciones" });
      await expect(input).toBeFocused();

      await page.keyboard.type("desemp");
      const target = dialog.getByRole("option", { name: "Desempeño" });
      await expect(target).toBeVisible();
      await expect(input).toHaveAttribute("aria-activedescendant", (await target.getAttribute("id")) ?? "missing id");
      await expect(dialog.locator("[aria-live=polite]")).toHaveText(/^\d+ resultados?$/);
      await expectNoWcagViolations(page, `cmdk ${role} destino`);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/performance$/);
      await expect(dialog).toBeHidden();
      expect(problems()).toEqual([]);
    });

    test("con 2 letras busca personas; una persona abre el directorio en ella", async ({ page }) => {
      const problems = watchPage(page);
      await openProtected(page, "/dashboard");
      const opener = page.getByRole("button", { name: "Buscar" });
      expect((await opener.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await opener.click();
      const dialog = page.getByRole("dialog", { name: "Buscar personas y secciones" });
      // The search box has the focus as soon as the dialog is open: nothing typed is lost.
      await expect(dialog.getByRole("combobox", { name: "Buscar personas y secciones" })).toBeFocused({ timeout: 100 });
      await page.keyboard.type("Patricia");
      const people = dialog.getByRole("group", { name: "Personas" });
      const person = people.getByRole("option", { name: /Patricia Castro/ });
      await expect(person).toBeVisible();
      // The destinations do not match "Patricia": the first option is the person.
      await expect(dialog.getByRole("combobox", { name: "Buscar personas y secciones" })).toHaveAttribute("aria-activedescendant", (await person.getAttribute("id")) ?? "missing id");
      await expectNoWcagViolations(page, `cmdk ${role} personas`);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/employees\?q=patricia\.castro%40acme\.dev$/);
      await expect(page.getByText("Patricia", { exact: false }).first()).toBeVisible();

      // Esc closes it and gives the focus back to the button that opened it.
      await opener.click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(opener).toBeFocused();
      expect(problems()).toEqual([]);
    });
  });
}
