// D44: every protected page, for each account that can open it, at 360, 768
// and 1280 px in light and dark: it renders (no redirect, no console error, no
// CSP violation), has no horizontal scroll, passes axe, and leaves its
// closing screenshot in e2e-artifacts/captures.
import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectNoWcagViolations } from "./support/axe";
import { artifactsDir, storageStatePath } from "./support/env";
import { HEIGHTS, PROTECTED_PAGES, THEMES, WIDTHS, captureFullPage, layoutProblems, openProtected, setTheme, watchPage, type Role } from "./support/pages";

for (const role of ["empleada", "admin"] as const satisfies readonly Role[]) {
  test.describe(`páginas protegidas (${role})`, () => {
    test.use({ storageState: async ({}, provide) => provide(storageStatePath(role)) });

    for (const target of PROTECTED_PAGES.filter((p) => p.roles.includes(role))) {
      test(`${target.name}: carga, axe y capturas a 360, 768 y 1280 px`, async ({ page }) => {
        const problems = watchPage(page);
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: HEIGHTS[width] });
          await setTheme(page, "light");
          await openProtected(page, target.path);
          const layout = await layoutProblems(page);
          expect(layout.horizontalScroll, `horizontal scroll at ${width} px`).toBe(0);
          expect(layout.unreachable, `navigation outside the window at ${width} px`).toEqual([]);
          for (const theme of THEMES) {
            await setTheme(page, theme);
            await expectNoWcagViolations(page, `${role}/${target.name} ${width}px (${theme})`);
            await captureFullPage(page, path.join(artifactsDir(), "captures", role, `${target.name}-${width}-${theme === "light" ? "claro" : "oscuro"}.png`));
          }
        }
        expect(problems()).toEqual([]);
      });
    }
  });
}

test.describe("login sin sesión", () => {
  test("login: axe y capturas a 360, 768 y 1280 px", async ({ page }) => {
    const problems = watchPage(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: HEIGHTS[width] });
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "Inicia sesión en tu cuenta" })).toBeVisible();
      expect((await layoutProblems(page)).horizontalScroll, `horizontal scroll at ${width} px`).toBe(0);
      for (const theme of THEMES) {
        await setTheme(page, theme);
        await expectNoWcagViolations(page, `login ${width}px (${theme})`);
        await captureFullPage(page, path.join(artifactsDir(), "captures", "login", `login-${width}-${theme === "light" ? "claro" : "oscuro"}.png`));
      }
    }
    expect(problems()).toEqual([]);
  });
});
