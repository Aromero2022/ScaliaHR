import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { globSync } from "glob";

const PROTECTED_DIR = resolve(__dirname, "../../src/app/(protected)");

const ALLOWLIST = new Set([
  // MFA flow: available to all authenticated users
  "mfa/enroll/page.tsx",
  "mfa/verify/page.tsx",
  // Own profile: all authenticated users
  "profile/page.tsx",
  // Dashboard home: all authenticated (optional can() for KPI visibility)
  "dashboard/page.tsx",
]);

function relPath(abs: string): string {
  return abs.slice(PROTECTED_DIR.length + 1);
}

describe("can() coverage in (protected) routes", () => {
  const pages = globSync("**/page.tsx", { cwd: PROTECTED_DIR });
  const actions = globSync("**/actions.ts", { cwd: PROTECTED_DIR });
  const files = [...pages, ...actions].sort();

  it("finds at least 10 protected files", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of files) {
    if (ALLOWLIST.has(file)) {
      it(`${file} is on the explicit allowlist`, () => {
        expect(ALLOWLIST.has(file)).toBe(true);
      });
      continue;
    }

    it(`${file} calls can()`, () => {
      const content = readFileSync(resolve(PROTECTED_DIR, file), "utf-8");
      const hasCan = /\bcan\s*\(/.test(content);
      expect(
        hasCan,
        `${file} does not call can(). Add a guard or add it to the ALLOWLIST in can-coverage.test.ts`,
      ).toBe(true);
    });
  }
});
