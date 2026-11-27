// 9c PR 6d (D51): the long form in steps ("Actualizar información personal"
// of "Tomar Acción") with the keyboard only, motion/react with and without
// prefers-reduced-motion, and the dashboard grid, on the production image.
import path from "node:path";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { expectNoWcagViolations } from "./support/axe";
import { artifactsDir, e2eAccounts, storageStatePath } from "./support/env";
import { HEIGHTS, THEMES, WIDTHS, openProtected, setTheme, watchPage } from "./support/pages";

const STEP = (n: number, title: string) => `Paso ${n} de 3: ${title}`;
// By accessible name: a required field's label also shows " *".
const field = (dialog: Locator, name: string) => dialog.getByRole("textbox", { name, exact: true });
const focusInside = (dialog: Locator) => dialog.evaluate((d) => d.contains(document.activeElement));

/**
 * Opens "Actualizar información personal" from the "Tomar Acción" menu with the keyboard.
 * `whileBusy` runs while the button waits for the dialog's data.
 */
async function openPersonal(page: Page, whileBusy?: (trigger: Locator) => Promise<void>) {
  const trigger = page.getByRole("button", { name: "Tomar Acción" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Cambio de puesto" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "Actualizar información personal" })).toBeFocused();
  await page.keyboard.press("Enter");
  if (whileBusy) await whileBusy(trigger);
  const dialog = page.getByRole("dialog", { name: /^Actualizar información personal — / });
  await expect(dialog).toBeVisible();
  return { dialog, trigger };
}

const stepTitle = (dialog: Locator, n: number, title: string) => dialog.getByRole("heading", { level: 3, name: STEP(n, title) });

async function axeAndCapture(page: Page, scan: string, capture: string) {
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await expectNoWcagViolations(page, `${scan} (${theme})`);
    await page.screenshot({ path: path.join(artifactsDir(), "captures", "pasos", `${capture}-${theme === "light" ? "claro" : "oscuro"}.png`) });
  }
  await setTheme(page, "light");
}

test.describe("formulario por pasos (9c PR 6d)", () => {
  test.use({ storageState: async ({}, provide) => provide(storageStatePath("admin")) });

  for (const width of WIDTHS) {
    test(`Actualizar información personal por pasos, con el teclado, a ${width} px`, async ({ page }) => {
      const { demo } = e2eAccounts();
      const problems = watchPage(page);
      await page.setViewportSize({ width, height: HEIGHTS[width] });
      await setTheme(page, "light");
      await openProtected(page, `/employees/${demo.jobChangeEmployeeId}`);
      const { dialog, trigger } = await openPersonal(page);

      // Step 1 opens with the focus inside the dialog, not moved to the title.
      await expect(stepTitle(dialog, 1, "Nombre")).toBeVisible();
      await expect.poll(() => focusInside(dialog)).toBe(true);
      await axeAndCapture(page, `pasos 1 ${width}px`, `paso-1-${width}`);

      // The dialog opens with no current data (action-menu passes none). With the
      // last name typed and the name left empty, the step does not go on, and
      // the one error is announced and marked.
      await field(dialog, "Apellido").fill("López");
      const name = field(dialog, "Nombre");
      await name.fill("");
      await name.press("Enter");
      await expect(stepTitle(dialog, 1, "Nombre")).toBeVisible();
      await expect(dialog.getByRole("alert").first()).toHaveText("Revisa 1 campo de este paso.");
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();
      await name.fill("Ana");
      await name.press("Enter");

      // Step 2 takes the focus on its title.
      await expect(stepTitle(dialog, 2, "Contacto")).toBeFocused();
      await axeAndCapture(page, `pasos 2 ${width}px`, `paso-2-${width}`);
      // "a@b" passes the browser's check but not the server's schema.
      const email = field(dialog, "Correo personal");
      await email.fill("a@b");
      await email.press("Enter");

      await expect(stepTitle(dialog, 3, "Domicilio y motivo")).toBeFocused();
      await axeAndCapture(page, `pasos 3 ${width}px`, `paso-3-${width}`);
      await field(dialog, "Motivo").fill("Prueba e2e de pasos");
      await field(dialog, "Motivo").press("Enter");

      // The server validates the whole object and sends the form back to the step of its error. Nothing is saved.
      await expect(stepTitle(dialog, 2, "Contacto")).toBeFocused();
      await expect(dialog.getByRole("alert").first()).toHaveText("Revisa los campos marcados.");
      await expect(email).toHaveAttribute("aria-invalid", "true");
      await expect(dialog.getByText("Escribe un correo válido, como nombre@dominio.com")).toBeVisible();
      await expectNoWcagViolations(page, `pasos error del servidor ${width}px`);

      // "Anterior" goes back with the focus on the title; Esc closes and gives the focus back to the button.
      await dialog.getByRole("button", { name: "Anterior" }).click();
      await expect(stepTitle(dialog, 1, "Nombre")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(problems()).toEqual([]);
    });
  }
});

type Frame = { transform: string; opacity: number };
const IDENTITY = new Set(["none", "matrix(1, 0, 0, 1, 0, 0)"]);

/** Samples the transform and opacity of an element for a few frames, from the next frame on. */
async function sample(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const w = window as unknown as { __frames: Frame[] };
    w.__frames = [];
    const tick = () => {
      const el = document.querySelector<HTMLElement>(sel);
      if (el && !el.hidden) {
        const style = getComputedStyle(el);
        w.__frames.push({ transform: style.transform, opacity: Number(style.opacity) });
      }
      if (w.__frames.length < 30) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, selector);
}
const frames = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);
/** Waits for the sampler's 30 frames (about half a second), well past the 150 ms animations. */
const allFrames = async (page: Page) => {
  await expect.poll(async () => (await frames(page)).length).toBe(30);
  return frames(page);
};

test.describe("motion/react y movimiento reducido (D51)", () => {
  test.use({ storageState: async ({}, provide) => provide(storageStatePath("admin")), viewport: { width: 1280, height: 800 } });

  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`el indicador de carga, el paso nuevo y el toast con prefers-reduced-motion: ${reducedMotion}`, async ({ page }) => {
      const { demo } = e2eAccounts();
      const problems = watchPage(page);
      await page.emulateMedia({ reducedMotion });

      const detail = `/employees/${demo.jobChangeEmployeeId}`;
      await openProtected(page, detail);
      // The Server Action that loads the dialog's data, held for a second so the button's spinner (D43) can be seen.
      const hold = async (route: Route) => {
        if (route.request().method() === "POST" && route.request().headers()["next-action"]) await new Promise((r) => setTimeout(r, 1000));
        await route.continue();
      };
      const isDetail = (url: URL) => url.pathname === detail;
      await page.route(isDetail, hold);
      const { dialog } = await openPersonal(page, async (trigger) => {
        await expect(trigger).toHaveAttribute("aria-busy", "true");
        const spinner = trigger.locator('span[aria-hidden="true"]');
        // It spins only without reduce: motion-safe:animate-spin.
        expect(await spinner.evaluate((el) => getComputedStyle(el).animationName)).toBe(reducedMotion === "reduce" ? "none" : "spin");
      });
      await page.unroute(isDetail, hold);
      await field(dialog, "Nombre").fill("Ana");
      await field(dialog, "Apellido").fill("López");
      await sample(page, '[data-step="contacto"]');
      await field(dialog, "Apellido").press("Enter");
      await expect(stepTitle(dialog, 2, "Contacto")).toBeFocused();
      const step = await allFrames(page);
      expect(step.length).toBeGreaterThan(0);
      if (reducedMotion === "reduce") {
        // It just appears: no frame moved or faded.
        for (const f of step) {
          expect(IDENTITY.has(f.transform), f.transform).toBe(true);
          expect(f.opacity).toBe(1);
        }
      } else {
        expect(step.some((f) => !IDENTITY.has(f.transform) || f.opacity < 1), "the step slides in").toBe(true);
        expect(step.at(-1)).toEqual({ transform: expect.stringMatching(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/), opacity: 1 });
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      // The toast of "crear rol" (a simulation, D43: nothing is written).
      await openProtected(page, "/admin-center/manage-roles");
      await page.getByRole("button", { name: "+ Nuevo Rol" }).click();
      const roleDialog = page.getByRole("dialog", { name: "Crear Nuevo Rol" });
      await roleDialog.getByLabel("Nombre del Rol").fill("Rol de prueba de movimiento");
      await sample(page, "[data-toast]");
      await roleDialog.getByLabel("Nombre del Rol").press("Enter");
      const toast = page.locator("[data-toast]").filter({ hasText: "Rol de prueba de movimiento" });
      await expect(toast).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "Rol de prueba de movimiento" })).toHaveAttribute("aria-live", "polite");
      const toastFrames = await allFrames(page);
      expect(toastFrames.length).toBeGreaterThan(0);
      if (reducedMotion === "reduce") {
        for (const f of toastFrames) {
          expect(IDENTITY.has(f.transform), f.transform).toBe(true);
          expect(f.opacity).toBe(1);
        }
      } else {
        expect(toastFrames.some((f) => !IDENTITY.has(f.transform) || f.opacity < 1), "the toast slides in").toBe(true);
      }
      // Its close button takes it out of the page (at once with reduce, after its fade without).
      await toast.getByRole("button", { name: "Cerrar mensaje" }).click();
      await expect(toast).toHaveCount(0);
      expect(problems()).toEqual([]);
    });
  }
});

test.describe("grid del dashboard (9c PR 6d)", () => {
  test.use({ storageState: async ({}, provide) => provide(storageStatePath("empleada")) });

  test("información y objetivos lado a lado a 1280 px y en una columna a 768 y 360 px", async ({ page }) => {
    const problems = watchPage(page);
    const box = async (name: string) =>
      (await page.locator("[data-dashboard-grid] > section").filter({ has: page.getByRole("heading", { level: 2, name }) }).boundingBox())!;
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: HEIGHTS[width] });
      await openProtected(page, "/dashboard");
      const info = await box("Mi Información");
      const goals = await box("Mis Objetivos (PMGM)");
      if (width === 1280) {
        expect(Math.abs(info.y - goals.y), "same row at 1280 px").toBeLessThan(1);
        expect(goals.x).toBeGreaterThan(info.x + info.width - 1);
      } else {
        expect(goals.y, `stacked at ${width} px`).toBeGreaterThanOrEqual(info.y + info.height - 1);
        expect(Math.abs(goals.x - info.x)).toBeLessThan(1);
      }
    }
    expect(problems()).toEqual([]);
  });
});
