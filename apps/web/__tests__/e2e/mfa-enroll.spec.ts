// D44: an hr_admin without a factor is sent to the forced enrollment, and
// enrolling with the app's code takes her to the page she asked for. The
// enrollment page shows a new TOTP secret: the test registers it for the
// artifact scan, and no screenshot of this page is ever taken.
import { expect, test } from "@playwright/test";
import { generateSync } from "otplib";
import { expectNoWcagViolations } from "./support/axe";
import { e2eAccounts, fillSecret, registerSecret, signIn } from "./support/env";
import { THEMES, setTheme, watchPage } from "./support/pages";

// The page snapshot Playwright adds to a failure (error-context) would copy the
// secret: whatever happens, the page is blank before the test's context closes,
// and the secret leaves the page as soon as the test has it.
test.afterEach(async ({ page }) => {
  await page.goto("about:blank");
});

test("admin sin factor: alta obligatoria de MFA y entrada al inicio", async ({ page }) => {
  const problems = watchPage(page);
  await page.goto("/login");
  await signIn(page, e2eAccounts().accounts.adminSinFactor.email, /\/mfa\/enroll\?next=%2Fdashboard$/);
  await expect(page.getByRole("heading", { name: "Configurar autenticación de dos factores" })).toBeVisible();
  // Registered before any assertion on it, so not even a failure message can print it unscanned.
  const secretBox = page.locator("main code");
  await expect(secretBox).toBeVisible();
  const secret = (await secretBox.textContent())?.trim() ?? "";
  if (secret.length >= 16) registerSecret(secret);
  expect(/^[A-Z2-7]{16,}$/.test(secret), "the page shows a base32 TOTP secret").toBe(true);

  for (const theme of THEMES) {
    await setTheme(page, theme);
    await expectNoWcagViolations(page, `mfa-enroll (${theme})`);
  }
  await setTheme(page, "light");
  // Read and scanned: the secret leaves the page before any assertion that could copy it.
  await secretBox.evaluate((el) => {
    el.textContent = "••••";
  });

  await fillSecret(page.getByLabel("Código de verificación"), generateSync({ secret }));
  await page.getByRole("button", { name: "Activar MFA" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("main h1")).toBeVisible();
  expect(problems()).toEqual([]);
});
