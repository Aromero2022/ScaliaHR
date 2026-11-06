// D44: the two real logins of the suite. Each one keeps its browser session
// in E2E_PRIVATE_DIR for the other tests, so the run signs in once per account
// (the login limit is 5 per minute per account, D28).
import { expect, test } from "@playwright/test";
import { generateSync } from "otplib";
import { expectNoWcagViolations } from "./support/axe";
import { e2eAccounts, fillSecret, signIn, storageStatePath } from "./support/env";
import { THEMES, setTheme, watchPage } from "./support/pages";

test("login de empleada: llega al inicio sin MFA", async ({ page }) => {
  const problems = watchPage(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Inicia sesión en tu cuenta" })).toBeVisible();
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await expectNoWcagViolations(page, `login (${theme})`);
  }
  await setTheme(page, "light");

  await signIn(page, e2eAccounts().accounts.empleada.email, /\/dashboard$/);
  await expect(page.locator("main h1")).toBeVisible();
  // An employee is not asked for MFA, but the Admin Center still is (AAL2 path).
  // Asked without rendering it: the enrollment page would create a factor.
  const adminCenter = await page.request.get("/admin-center", { maxRedirects: 0 });
  expect(adminCenter.status()).toBe(307);
  expect(adminCenter.headers().location).toMatch(/\/mfa\/enroll\?next=%2Fadmin-center$/);
  expect(problems()).toEqual([]);
  await page.context().storageState({ path: storageStatePath("empleada") });
});

test("login de admin con MFA: verifica el código TOTP y entra a Administración", async ({ page }) => {
  const problems = watchPage(page);
  const admin = e2eAccounts().accounts.admin;
  await page.goto("/login");
  // hr_admin needs AAL2 everywhere; with a verified factor the next step is the verification.
  await signIn(page, admin.email, /\/mfa\/verify\?next=%2Fdashboard$/);
  await expect(page.getByRole("heading", { name: "Verificar identidad" })).toBeVisible();
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await expectNoWcagViolations(page, `mfa-verify (${theme})`);
  }
  await setTheme(page, "light");

  const secret = admin.totp?.secret;
  if (!secret) throw new Error("the admin account has no TOTP factor");
  await fillSecret(page.getByLabel("Código TOTP"), generateSync({ secret }));
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/admin-center");
  await expect(page).toHaveURL(/\/admin-center$/);
  await expect(page.locator("main h1")).toBeVisible();
  expect(problems()).toEqual([]);
  await page.context().storageState({ path: storageStatePath("admin") });
});
