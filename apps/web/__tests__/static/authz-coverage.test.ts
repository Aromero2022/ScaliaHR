import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Static analysis: every page.tsx and Server Action (actions.ts) under
 * (protected) must import and call can() — unless explicitly allow-listed.
 *
 * Allowlist rationale:
 *   mfa/*        – MFA enrollment/verification is pre-authorization
 *   profile      – own-profile self-service, visible to every authenticated user
 *   layout.tsx   – calls can() for sidebar filtering, but is not a page/action
 */
const ALLOWLIST = new Set([
  "mfa/enroll/page.tsx",
  "mfa/verify/page.tsx",
  "profile/page.tsx",
]);

const PROTECTED_ROOT = path.resolve(
  __dirname,
  "../../src/app/(protected)",
);

function walk(dir: string, base = ""): string[] {
  const entries: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      entries.push(...walk(path.join(dir, ent.name), rel));
    } else if (ent.name === "page.tsx" || ent.name === "actions.ts") {
      entries.push(rel);
    }
  }
  return entries;
}

describe("authorization coverage", () => {
  const files = walk(PROTECTED_ROOT);

  const pages = files.filter((f) => f.endsWith("page.tsx"));
  const actions = files.filter((f) => f.endsWith("actions.ts"));

  it("finds at least 10 protected pages", () => {
    expect(pages.length).toBeGreaterThanOrEqual(10);
  });

  it("finds at least 3 server actions", () => {
    expect(actions.length).toBeGreaterThanOrEqual(3);
  });

  for (const rel of [...pages, ...actions]) {
    if (ALLOWLIST.has(rel)) continue;

    it(`${rel} imports can()`, () => {
      const content = fs.readFileSync(
        path.join(PROTECTED_ROOT, rel),
        "utf-8",
      );
      const importsCan = /from\s+["']@\/lib\/authz\/can["']/.test(content);
      expect(
        importsCan,
        `${rel} does not import can() from @/lib/authz/can`,
      ).toBe(true);
    });

    it(`${rel} calls can()`, () => {
      const content = fs.readFileSync(
        path.join(PROTECTED_ROOT, rel),
        "utf-8",
      );
      const callsCan = /\bcan\s*\(/.test(content);
      expect(
        callsCan,
        `${rel} imports but never calls can()`,
      ).toBe(true);
    });
  }
});
