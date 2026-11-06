import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// D44: the e2e suite runs against the production image of the local stack
// (scripts/e2e.sh, after `npm run local:up`), with accounts that scripts/e2e-accounts.mjs
// creates and deletes. No retries: CI reruns the job once at most, and a
// retry here would hide a flaky test. No trace, video or automatic screenshot:
// they would record what the tests type; the closing screenshots are taken on
// purpose. Everything lands in e2e-artifacts, which CI uploads after scanning it.
const artifacts = process.env.E2E_ARTIFACTS_DIR ?? path.join(__dirname, "e2e-artifacts");

export default defineConfig({
  testDir: "__tests__/e2e",
  outputDir: path.join(artifacts, "results"),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  // "list" in the log; the HTML report is a file for the job's artifact and never opens a server.
  reporter: [["list"], ["html", { open: "never", outputFolder: path.join(artifacts, "report") }]],
  globalTeardown: "./__tests__/e2e/support/axe-summary.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "login",
      testMatch: /login\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? undefined } },
    },
    {
      name: "chromium",
      dependencies: ["login"],
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? undefined } },
    },
  ],
});
