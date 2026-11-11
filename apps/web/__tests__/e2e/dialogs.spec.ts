// D44: the three Dialogs of D43 with the keyboard only (nuevo objetivo and
// feedback for the employee, crear rol for the admin), at 1280 px light and
// 360 px dark, and axe with each dialog open in light and dark. 9c PR 6a adds
// "Tomar Acción", which now opens from its menu straight on the chosen form.
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoWcagViolations } from "./support/axe";
import { artifactsDir, e2eAccounts, storageStatePath } from "./support/env";
import { THEMES, setTheme, openProtected, watchPage } from "./support/pages";

const LAYOUTS = [
  { width: 1280, height: 800, theme: "light" },
  { width: 360, height: 800, theme: "dark" },
] as const;

const focusInside = (dialog: Locator) => dialog.evaluate((d) => d.contains(document.activeElement));
/**
 * With a native modal <dialog>, Tab past its last control goes to the
 * browser's own interface (the address bar), as the HTML spec allows, and the
 * next Tab comes back to the dialog. Headless Chrome has no address bar, so
 * for that one press nothing in the page has focus. What must never happen is
 * the focus landing on the page behind the dialog, which showModal() makes inert.
 */
const focusNotBehind = (dialog: Locator) =>
  dialog.evaluate((d) => {
    const active = document.activeElement;
    return !active || active === document.body || d.contains(active);
  });

/**
 * Opens the dialog from its button with Enter, and checks what D43 promises:
 * it is modal and named by its title, the focus starts inside, 25 Tab and 25
 * Shift+Tab presses never put it on the page behind and keep coming back
 * inside, and Esc closes it and gives the focus back to the button. Returns
 * the open dialog, re-opened, for axe.
 */
async function checkWithKeyboard(page: Page, opener: Locator, title: string): Promise<Locator> {
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((d) => d.matches(":modal")), "the dialog is modal").toBe(true);
  await expect.poll(() => focusInside(dialog), { message: "focus moves into the dialog" }).toBe(true);
  for (const key of ["Tab", "Shift+Tab"]) {
    let insideCount = 0;
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press(key);
      expect(await focusNotBehind(dialog), `${key} #${i + 1} never reaches the page behind the dialog`).toBe(true);
      if (await focusInside(dialog)) insideCount++;
    }
    expect(insideCount, `${key} keeps coming back into the dialog`).toBeGreaterThan(20);
  }
  // A person presses Esc from inside the dialog (from the address bar, Esc never reaches the page).
  if (!(await focusInside(dialog))) await page.keyboard.press("Tab");
  expect(await focusInside(dialog)).toBe(true);
  const element = await dialog.elementHandle();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // The Dialog unmounts its content once React has handled the close event.
  await expect.poll(() => element?.evaluate((d) => d.childElementCount)).toBe(0);
  await expect(opener).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function axeWithDialogOpen(page: Page, scan: string, capture: string) {
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await expectNoWcagViolations(page, `${scan} (${theme})`);
    await page.screenshot({ path: path.join(artifactsDir(), "captures", "dialogos", `${capture}-${theme === "light" ? "claro" : "oscuro"}.png`) });
  }
}

test.describe("diálogos de la empleada", () => {
  test.use({ storageState: async ({}, provide) => provide(storageStatePath("empleada")) });

  for (const layout of LAYOUTS) {
    test(`nuevo objetivo y feedback con el teclado a ${layout.width} px (${layout.theme})`, async ({ page }) => {
      const problems = watchPage(page);
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await setTheme(page, layout.theme);
      await openProtected(page, "/performance");

      const goal = await checkWithKeyboard(page, page.getByRole("button", { name: "+ Nuevo Objetivo" }), "Nuevo Objetivo");
      await axeWithDialogOpen(page, `dialogo nuevo objetivo ${layout.width}px`, `nuevo-objetivo-${layout.width}`);
      await page.keyboard.press("Escape");
      await expect(goal).toBeHidden();

      const tab = page.getByRole("button", { name: /^Feedback Continuo/ });
      await tab.focus();
      await page.keyboard.press("Enter");
      await expect(tab).toHaveAttribute("aria-pressed", "true");
      const feedback = await checkWithKeyboard(page, page.getByRole("button", { name: "+ Enviar Feedback" }), "Enviar Feedback");
      await axeWithDialogOpen(page, `dialogo feedback ${layout.width}px`, `feedback-${layout.width}`);
      await page.keyboard.press("Escape");
      await expect(feedback).toBeHidden();
      expect(problems()).toEqual([]);
    });
  }
});

test.describe("diálogo del admin", () => {
  test.use({ storageState: async ({}, provide) => provide(storageStatePath("admin")) });

  for (const layout of LAYOUTS) {
    test(`crear rol con el teclado a ${layout.width} px (${layout.theme}), con su toast`, async ({ page }) => {
      const problems = watchPage(page);
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await setTheme(page, layout.theme);
      await openProtected(page, "/admin-center/manage-roles");

      const dialog = await checkWithKeyboard(page, page.getByRole("button", { name: "+ Nuevo Rol" }), "Crear Nuevo Rol");
      await axeWithDialogOpen(page, `dialogo crear rol ${layout.width}px`, `crear-rol-${layout.width}`);

      // Submitted with the keyboard. Creating a role is still a simulation (D43): nothing is written.
      await expect.poll(() => focusInside(dialog)).toBe(true);
      await dialog.getByLabel("Nombre del Rol").focus();
      await page.keyboard.type("Rol de prueba e2e");
      await page.keyboard.press("Enter");
      await expect(dialog).toBeHidden();
      const status = page.getByRole("status").filter({ hasText: "Rol de prueba e2e" });
      await expect(status).toBeVisible();
      await expect(status).toHaveAttribute("aria-live", "polite");
      expect(problems()).toEqual([]);
    });
  }
});

test.describe("Tomar Acción del admin", () => {
  test.use({ storageState: async ({}, provide) => provide(storageStatePath("admin")) });

  for (const layout of LAYOUTS) {
    test(`un solo botón, abre en la opción elegida y devuelve el foco, a ${layout.width} px (${layout.theme})`, async ({ page }) => {
      const { demo } = e2eAccounts();
      const problems = watchPage(page);
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await setTheme(page, layout.theme);
      await openProtected(page, `/employees/${demo.jobChangeEmployeeId}`);

      // One button: before 9c PR 6a the menu rendered a second "Tomar Acción" and the dialog asked for the type again.
      const trigger = page.getByRole("button", { name: "Tomar Acción" });
      await expect(trigger).toHaveCount(1);

      const open = async () => {
        await trigger.focus();
        await page.keyboard.press("Enter");
        // 9c PR 6b: the menu opens on its first option (menu button pattern).
        await expect(page.getByRole("menuitem", { name: "Cambio de puesto" })).toBeFocused();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: /^Cambio de puesto — / });
        await expect(dialog).toBeVisible();
        return dialog;
      };

      const dialog = await open();
      expect(await dialog.evaluate((d) => d.matches(":modal")), "the dialog is modal").toBe(true);
      await expect(dialog.getByLabel("Título del Puesto")).toBeVisible();
      await expect(dialog.getByText("Seleccione el tipo de acción")).toHaveCount(0);
      await expect.poll(() => focusInside(dialog), { message: "focus moves into the dialog" }).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveCount(1);

      await open();
      await axeWithDialogOpen(page, `dialogo tomar accion ${layout.width}px`, `tomar-accion-${layout.width}`);
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      expect(problems()).toEqual([]);
    });
  }
});

test.describe("menú Tomar Acción (botón de menú de ARIA)", () => {
  test.use({ storageState: async ({}, provide) => provide(storageStatePath("admin")) });

  test("se abre, se recorre y se cierra con el teclado, y mide 44 px", async ({ page }) => {
    const { demo } = e2eAccounts();
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openProtected(page, `/employees/${demo.jobChangeEmployeeId}`);
    const trigger = page.getByRole("button", { name: "Tomar Acción" });
    const menu = page.getByRole("menu", { name: "Tomar Acción" });
    const item = (name: string) => menu.getByRole("menuitem", { name });

    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect((await trigger.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(menu).toBeHidden();

    // Enter opens it on the first option.
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(trigger).toHaveAttribute("aria-controls", (await menu.getAttribute("id")) ?? "missing id");
    await expect(item("Cambio de puesto")).toBeFocused();
    for (const box of await menu.getByRole("menuitem").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    // The arrows move and wrap; Home and End go to the ends.
    await page.keyboard.press("ArrowDown");
    await expect(item("Cambio de compensación")).toBeFocused();
    await page.keyboard.press("End");
    await expect(item("Actualizar información personal")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(item("Cambio de puesto")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(item("Actualizar información personal")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(item("Cambio de puesto")).toBeFocused();
    await expectNoWcagViolations(page, "menu tomar accion abierto");

    // Esc closes it and gives the focus back to the button.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Up opens it on the last option; Tab closes it.
    await page.keyboard.press("ArrowUp");
    await expect(item("Actualizar información personal")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Space opens it; a click elsewhere closes it.
    await trigger.focus();
    await page.keyboard.press("Space");
    await expect(item("Cambio de puesto")).toBeFocused();
    await page.getByRole("heading", { level: 2, name: "Información Laboral" }).click();
    await expect(menu).toBeHidden();
    expect(problems()).toEqual([]);
  });

  test("mientras cargan las listas, el botón está ocupado y no acepta un segundo clic", async ({ page }) => {
    const { demo } = e2eAccounts();
    const problems = watchPage(page);
    const detail = `/employees/${demo.jobChangeEmployeeId}`;
    await openProtected(page, detail);
    // The Server Action that loads the dialog's lists, held for a second so its loading state can be seen.
    let calls = 0;
    await page.route(
      (url) => url.pathname === detail,
      async (route) => {
        if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
          calls++;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        await route.continue();
      },
    );
    const trigger = page.getByRole("button", { name: "Tomar Acción" });
    await trigger.click();
    await page.getByRole("menuitem", { name: "Cambio de puesto" }).click();
    await expect(trigger).toHaveAttribute("aria-busy", "true");
    await expect(trigger).toBeDisabled();
    await trigger.click({ force: true });
    const dialog = page.getByRole("dialog", { name: /^Cambio de puesto — / });
    await expect(dialog).toBeVisible();
    await expect(trigger).not.toHaveAttribute("aria-busy", "true");
    expect(calls, "one load for one choice").toBe(1);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    expect(problems()).toEqual([]);
  });
});
