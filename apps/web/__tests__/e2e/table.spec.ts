// D43, each row rendered once (D36, the user's decision of 2026-11-28): on the
// production image, /employees lays out the one markup of Table as a table
// from 768 px and as cards under it. In Chromium, at 1280, 768, 360 and 320 px:
// - each employee once (no second copy of the rows), with one profile link;
// - the six column headers in the accessibility tree at every width, visible
//   from 768 px and visually hidden under it;
// - table display from 768 px and blocks under it, where each card shows the
//   labels of its fields;
// - no horizontal scroll, and the first profile link reached with Tab and
//   showing its focus ring.
// pages.spec.ts runs axe on the same page at 360, 768 and 1280 px.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { storageStatePath } from "./support/env";
import { openProtected } from "./support/pages";

const HEADERS = ["Empleado", "Puesto", "Departamento", "Número de empleado", "Estado", "Acciones"];
const display = (target: Locator) => target.evaluate((el) => getComputedStyle(el).display);

async function rendered(page: Page) {
  const table = page.getByRole("table", { name: "Empleados" });
  const links = table.getByRole("link", { name: /^Ver perfil de / });
  const count = await links.count();
  expect(count, "employees on the page").toBeGreaterThan(0);
  await expect(table.getByRole("row"), "the header row and one row per employee").toHaveCount(count + 1);
  const hrefs = await links.evaluateAll((all) => all.map((a) => a.getAttribute("href")));
  expect(new Set(hrefs).size, "each profile link once").toBe(count);
  await expect(table.getByRole("columnheader")).toHaveText(HEADERS);
  return { table, row: table.getByRole("row").nth(1), links };
}

async function horizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("empleados: una sola vez cada fila (D43)", () => {
  test.use({ storageState: async ({}, provide) => provide(storageStatePath("admin")) });

  for (const width of [1280, 768]) {
    test(`tabla a ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openProtected(page, "/employees");
      const { table, row } = await rendered(page);
      expect(await display(table)).toBe("table");
      expect(await display(row)).toBe("table-row");
      expect(await display(row.getByRole("cell").first())).toBe("table-cell");
      const header = await table.getByRole("columnheader").first().boundingBox();
      expect(header!.height, "the header row is visible").toBeGreaterThan(10);
      for (const label of HEADERS.slice(0, 5)) await expect(row.getByText(label, { exact: true })).toBeHidden();
      expect(await horizontalScroll(page)).toBeLessThanOrEqual(0);
    });
  }

  for (const width of [360, 320]) {
    test(`tarjetas a ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openProtected(page, "/employees");
      const { table, row, links } = await rendered(page);
      expect(await display(table)).toBe("block");
      expect(await display(row)).toBe("block");
      expect(await display(row.getByRole("cell").first())).toBe("block");
      const header = await table.getByRole("columnheader").first().boundingBox();
      expect(header!.width, "the header row is visually hidden").toBeLessThanOrEqual(1);
      for (const label of HEADERS.slice(0, 5)) await expect(row.getByText(label, { exact: true })).toBeVisible();
      expect(await horizontalScroll(page)).toBeLessThanOrEqual(0);

      const first = links.first();
      let reached = false;
      for (let i = 0; i < 60 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await first.evaluate((el) => el === document.activeElement);
      }
      expect(reached, "the first profile link is reached with Tab").toBe(true);
      expect(await first.evaluate((el) => el.matches(":focus-visible") && getComputedStyle(el).outlineStyle !== "none")).toBe(true);
    });
  }
});
