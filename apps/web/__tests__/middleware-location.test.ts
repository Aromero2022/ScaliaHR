import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import path from "path";

const webRoot = path.resolve(__dirname, "..");

describe("middleware file location", () => {
  it("must live inside src/ for Next.js to load it", () => {
    expect(
      existsSync(path.join(webRoot, "src", "middleware.ts")),
    ).toBe(true);
  });

  it("must NOT exist at the project root (silently ignored when src/ is used)", () => {
    expect(
      existsSync(path.join(webRoot, "middleware.ts")),
    ).toBe(false);
  });
});
