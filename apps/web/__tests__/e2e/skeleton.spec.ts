// D44: the skeleton experiment. Pages load in under 400 ms, so D43 could not
// see the skeleton in a browser. Here the test, and only the test, holds the
// server's answer to one navigation for 2 s (Playwright delays that RSC
// response; the app is not changed). A sampler records, every frame from the
// click, whether the skeleton is in the page and its opacity. Evidence:
// skeleton/linea-de-tiempo.json and two screenshots, before and after 400 ms.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { artifactsDir, storageStatePath } from "./support/env";
import { openProtected } from "./support/pages";

const HOLD_MS = 2000;
type Sample = { t: number; present: boolean; opacity: number | null; shimmer: string | null };

async function slowNavigation(page: Page, label: string) {
  const dir = path.join(artifactsDir(), "skeleton");
  mkdirSync(dir, { recursive: true });
  await openProtected(page, "/dashboard");
  // Hold the navigation's RSC answer for /employees; the router's prefetches go through untouched.
  await page.route(
    (url) => url.pathname === "/employees",
    async (route) => {
      const headers = route.request().headers();
      if (headers.rsc === "1" && !headers["next-router-prefetch"]) await new Promise((r) => setTimeout(r, HOLD_MS));
      await route.continue();
    },
  );
  const link = page.locator("nav[data-collapsed]").getByRole("link", { name: "Empleados" });
  await link.evaluate((a) => {
    const w = window as unknown as { __samples: Sample[] };
    w.__samples = [];
    a.addEventListener(
      "click",
      () => {
        const start = performance.now();
        const tick = () => {
          const region = document.querySelector(".skeleton-region");
          const block = document.querySelector(".skeleton-block");
          w.__samples.push({
            t: Math.round(performance.now() - start),
            present: !!region,
            opacity: region ? Number(getComputedStyle(region).opacity) : null,
            shimmer: block ? getComputedStyle(block).animationName : null,
          });
          if (performance.now() - start < 2600) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { capture: true, once: true },
    );
  });
  await link.click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(dir, `${label}-antes-400ms.png`) });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(dir, `${label}-despues-400ms.png`) });
  await expect(page).toHaveURL(/\/employees$/);
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator(".skeleton-region")).toHaveCount(0);
  await page.waitForTimeout(800);
  const samples = await page.evaluate(() => (window as unknown as { __samples: Sample[] }).__samples);
  const appeared = samples.find((s) => s.present);
  const shown = samples.find((s) => s.present && s.opacity === 1);
  const timeline = {
    holdMs: HOLD_MS,
    frames: samples.length,
    insertedAtMs: appeared?.t ?? null,
    visibleAtMs: shown?.t ?? null,
    visibleAfterInsertMs: appeared && shown ? shown.t - appeared.t : null,
    shimmer: shown?.shimmer ?? null,
    removedAtMs: samples.find((s, i) => i > 0 && samples[i - 1].present && !s.present)?.t ?? null,
    samples,
  };
  writeFileSync(path.join(dir, `${label}-linea-de-tiempo.json`), JSON.stringify(timeline, null, 2));
  return timeline;
}

test.describe("skeleton en una navegación lenta", () => {
  test.use({ storageState: async ({}, provide) => provide(storageStatePath("admin")), viewport: { width: 1280, height: 800 } });

  test("aparece solo después de 400 ms y se va al llegar la página", async ({ page }) => {
    const t = await slowNavigation(page, "movimiento");
    expect(t.insertedAtMs, "the loading boundary shows the skeleton right away").not.toBeNull();
    expect(t.insertedAtMs!).toBeLessThan(300);
    // Invisible (opacity 0) for its first 400 ms in the page, then fully visible.
    for (const s of t.samples.filter((s) => s.present && s.t - t.insertedAtMs! < 380)) expect(s.opacity).toBe(0);
    expect(t.visibleAfterInsertMs).toBeGreaterThanOrEqual(380);
    expect(t.visibleAfterInsertMs).toBeLessThan(700);
    expect(t.shimmer).toBe("skeleton-shimmer");
    expect(t.removedAtMs, "the page replaces it").not.toBeNull();
  });

  test("con movimiento reducido aparece igual, sin brillo animado", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const t = await slowNavigation(page, "movimiento-reducido");
    expect(t.visibleAfterInsertMs).toBeGreaterThanOrEqual(380);
    expect(t.shimmer).toBe("none");
  });
});
