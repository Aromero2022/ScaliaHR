// D44: the D41 navigation in the production image. Under 768 px the dock has
// at most 5 entries and "Más" opens the rest in a modal dialog that works with
// the keyboard alone; from 768 px the rail, and from 1280 px the sidebar.
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectNoWcagViolations } from "./support/axe";
import { artifactsDir, storageStatePath } from "./support/env";
import { THEMES, setTheme, openProtected, watchPage, type Role } from "./support/pages";

const visibleNavs = (page: Page) =>
  page.getByRole("navigation", { name: "Principal" }).evaluateAll((navs) =>
    navs.filter((n) => getComputedStyle(n).display !== "none").map((n) => (n.className.includes("fixed") ? "dock" : n.hasAttribute("data-collapsed") ? "sidebar" : "rail")),
  );

for (const role of ["empleada", "admin"] as const satisfies readonly Role[]) {
  test.describe(`navegación (${role})`, () => {
    test.use({ storageState: async ({}, provide) => provide(storageStatePath(role)) });

    test("dock y diálogo Más con el teclado a 360 px", async ({ page }) => {
      const problems = watchPage(page);
      await page.setViewportSize({ width: 360, height: 800 });
      await openProtected(page, "/dashboard");
      expect(await visibleNavs(page)).toEqual(["dock"]);

      const dock = page.getByRole("navigation", { name: "Principal" }).filter({ has: page.getByRole("button", { name: "Más" }) });
      const entries = dock.locator(":scope > ul > li > :is(a, button)");
      expect(await entries.count()).toBe(5);
      for (const box of await entries.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })))) {
        expect(box.w).toBeGreaterThanOrEqual(44);
        expect(box.h).toBeGreaterThanOrEqual(44);
      }
      await expect(dock.getByRole("link", { name: "Inicio" })).toHaveAttribute("aria-current", "page");

      const more = dock.getByRole("button", { name: "Más" });
      await more.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Más secciones" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      await expect(more).toHaveAttribute("aria-expanded", "true");
      // axe cannot confirm an aria-controls target next to aria-haspopup ("incomplete"); this does.
      await expect(more).toHaveAttribute("aria-controls", (await dialog.getAttribute("id")) ?? "missing id");
      const inside = () => dialog.evaluate((d) => d.contains(document.activeElement));
      expect(await inside()).toBe(true);
      for (const key of ["Tab", "Shift+Tab"]) {
        for (let i = 0; i < 25; i++) {
          await page.keyboard.press(key);
          expect(await inside(), `${key} #${i + 1} stays in "Más"`).toBe(true);
        }
      }
      for (const theme of THEMES) {
        await setTheme(page, theme);
        await expectNoWcagViolations(page, `${role}/dialogo Más 360px (${theme})`);
        await page.screenshot({ path: path.join(artifactsDir(), "captures", "dialogos", `mas-${role}-360-${theme === "light" ? "claro" : "oscuro"}.png`) });
      }
      await setTheme(page, "light");

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(more).toBeFocused();
      await expect(more).toHaveAttribute("aria-expanded", "false");

      // A link inside "Más" navigates and closes the dialog.
      await page.keyboard.press("Enter");
      const performance = dialog.getByRole("link", { name: "Desempeño" });
      await performance.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/performance$/);
      await expect(dialog).toBeHidden();
      await expect(dock.getByRole("button", { name: "Más" })).toBeVisible();
      expect(problems()).toEqual([]);
    });

    test("rail a 768 px y sidebar a 1280 px", async ({ page }) => {
      const problems = watchPage(page);
      await page.setViewportSize({ width: 768, height: 1024 });
      await openProtected(page, "/dashboard");
      expect(await visibleNavs(page)).toEqual(["rail"]);

      await page.setViewportSize({ width: 1280, height: 800 });
      await openProtected(page, "/dashboard");
      expect(await visibleNavs(page)).toEqual(["sidebar"]);
      const sidebar = page.locator("nav[data-collapsed]");
      const toggle = sidebar.getByRole("button", { name: "Contraer menú" });
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(sidebar).toHaveAttribute("data-collapsed", "1");
      // The server renders it collapsed after a reload (cookie, D41).
      await page.reload();
      await expect(page.locator("nav[data-collapsed]")).toHaveAttribute("data-collapsed", "1");
      await page.getByRole("button", { name: "Expandir menú" }).click();
      await expect(page.locator("nav[data-collapsed]")).toHaveAttribute("data-collapsed", "0");
      expect(problems()).toEqual([]);
    });
  });
}
