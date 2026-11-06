// D44: what scripts/e2e-accounts.mjs leaves in E2E_PRIVATE_DIR for this run.
// That folder is outside the repository and the artifacts; nothing read from
// it goes into a test title, a log line, a report or a screenshot.
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";

export type AccountKey = "empleada" | "admin" | "adminSinFactor";
type Account = { email: string; userId: string; totp?: { secret: string } };
type Accounts = { password: string; accounts: Record<AccountKey, Account> };

function privateDir(): string {
  const dir = process.env.E2E_PRIVATE_DIR;
  if (!dir) throw new Error("E2E_PRIVATE_DIR is not set: run the suite with npm run e2e (scripts/e2e.sh)");
  return dir;
}

let cached: Accounts | null = null;
export function e2eAccounts(): Accounts {
  cached ??= JSON.parse(readFileSync(path.join(privateDir(), "accounts.json"), "utf-8")) as Accounts;
  return cached;
}

/** The browser session of an account after its login test, kept with the secrets. */
export function storageStatePath(key: "empleada" | "admin"): string {
  return path.join(privateDir(), `state-${key}.json`);
}

/** A secret a test saw on screen (the enrollment page's), so the artifact scan looks for it too. */
export function registerSecret(value: string): void {
  if (value.length < 16) throw new Error("refusing to register a secret too short to scan for");
  appendFileSync(path.join(privateDir(), "runtime-secrets.txt"), `${value}\n`, { mode: 0o600 });
}

export function artifactsDir(): string {
  return process.env.E2E_ARTIFACTS_DIR ?? path.join(__dirname, "..", "..", "..", "e2e-artifacts");
}

/**
 * Types a secret without Playwright's fill(), whose step title carries the
 * value ('Fill "…"') into the report. The native setter plus an input event
 * is what React reads from a keystroke; the step shows up as "Evaluate".
 */
export async function fillSecret(field: Locator, value: string): Promise<void> {
  await field.focus();
  await field.evaluate((element, secret) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, secret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/**
 * Signs in through the login form and waits for the page it lands on. A
 * failing expect() copies the page into the report as an ARIA snapshot, and
 * that snapshot shows what a password field holds. So the wait is
 * waitForURL(), which adds no snapshot, and if the page stays on /login the
 * password field is emptied before anything else can fail.
 */
export async function signIn(page: Page, email: string, landing: RegExp): Promise<void> {
  const form = page.locator("form");
  await form.getByLabel("Código de empresa (opcional)").fill("acme-corp");
  await form.getByLabel("Correo electrónico").fill(email);
  const password = form.getByLabel("Contraseña");
  await fillSecret(password, e2eAccounts().password);
  await form.getByRole("button", { name: "Iniciar sesión" }).click();
  try {
    await page.waitForURL(landing, { timeout: 15_000 });
  } finally {
    if (new URL(page.url()).pathname === "/login") await fillSecret(password, "");
  }
}
