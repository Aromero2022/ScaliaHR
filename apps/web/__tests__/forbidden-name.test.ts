import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

const _P1 = "tal";
const _P2 = "ent";
const _P3 = "go";
const OLD_NAME_REGEX = `${_P1}${_P2}[_ -]?${_P3}`;

describe("Forbidden old project name", () => {
  it("does not appear in any tracked file contents", () => {
    const hits = execSync(
      `git grep -inE "${OLD_NAME_REGEX}" -- ':!node_modules' ':!.next' ':!dist' 2>/dev/null || true`,
      { encoding: "utf-8" },
    ).trim();
    expect(hits).toBe("");
  });

  it("does not appear in any tracked file or directory name", () => {
    const hits = execSync(
      `git ls-files | grep -iE "${OLD_NAME_REGEX}" || true`,
      { encoding: "utf-8" },
    ).trim();
    expect(hits).toBe("");
  });
});
