// D44: zoom. Reflow (WCAG 1.4.10): at 640 px, what a 1280 px window shows at
// 200 % zoom, no page scrolls sideways and nothing is drawn on top of
// anything else. Resize text (1.4.4): at 1280 px with the root font size at
// 200 %, the same, and no text is cut, or wider than its box, that was whole
// at 100 %.
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { artifactsDir, storageStatePath } from "./support/env";
import { PROTECTED_PAGES, captureFullPage, layoutProblems, openProtected, type LayoutReport, type Role } from "./support/pages";

function expectWhole(report: LayoutReport, where: string, before?: LayoutReport) {
  expect(report.horizontalScroll, `${where}: horizontal scroll`).toBe(0);
  expect(report.overlaps, `${where}: overlapping text or controls`).toEqual([]);
  expect(report.offscreen, `${where}: text off the left edge`).toEqual([]);
  expect(report.unreachable, `${where}: text of a fixed or sticky bar outside the window`).toEqual([]);
  expect(report.clipped.filter((c) => !before?.clipped.includes(c)), `${where}: text cut only at 200 %`).toEqual([]);
  expect(report.spilled.filter((c) => !before?.spilled.includes(c)), `${where}: text wider than its box`).toEqual([]);
}

async function checkZoom(page: Page, name: string, open: () => Promise<void>) {
  const shot = (file: string) => captureFullPage(page, path.join(artifactsDir(), "captures", "zoom", `${file}.png`));

  await page.setViewportSize({ width: 640, height: 800 });
  await open();
  expectWhole(await layoutProblems(page), `${name} at 640 px`);
  await shot(`${name}-640`);

  await page.setViewportSize({ width: 1280, height: 800 });
  await open();
  const before = await layoutProblems(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize), "body text doubles").toBe("32px");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expectWhole(await layoutProblems(page), `${name} at 1280 px with text at 200 %`, before);
  await shot(`${name}-1280-texto-200`);
}

for (const role of ["empleada", "admin"] as const satisfies readonly Role[]) {
  test.describe(`zoom (${role})`, () => {
    test.use({ storageState: async ({}, provide) => provide(storageStatePath(role)) });

    for (const target of PROTECTED_PAGES.filter((p) => p.roles.includes(role))) {
      test(`${target.name}: reflow a 640 px y texto al 200 % a 1280 px`, async ({ page }) => {
        await checkZoom(page, `${role}-${target.name}`, () => openProtected(page, target.path));
      });
    }
  });
}

test("login: reflow a 640 px y texto al 200 % a 1280 px", async ({ page }) => {
  await checkZoom(page, "login", async () => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Inicia sesión en tu cuenta" })).toBeVisible();
  });
});
