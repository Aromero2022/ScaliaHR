import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sourceFiles } from "./source-exports";
import { EASE_STANDARD, MOTION_SECONDS } from "@/components/ui/motion";

/**
 * D51: motion/react only in client components, only through `m.*` under the
 * MotionProvider's LazyMotion (so its animation features stay out of the
 * initial JS), never framer-motion directly, and with the same durations as
 * the D40 tokens in globals.css.
 */

const MOTION_IMPORT = /from\s+["'](motion\/react(?:-m|-client)?|framer-motion)["']/;

export function motionProblems(rel: string, source: string): string[] {
  if (!MOTION_IMPORT.test(source)) return [];
  const problems: string[] = [];
  if (!/^\s*["']use client["']/.test(source) && !rel.endsWith("motion-features.ts")) problems.push(`${rel}: imports motion without "use client"`);
  if (/from\s+["'](framer-motion|motion\/react-client)["']/.test(source)) problems.push(`${rel}: imports framer-motion or motion/react-client`);
  if (/<motion\.[a-z]/.test(source) || /\bimport\s*\{[^}]*\bmotion\b[^}]*\}\s*from\s*["']motion\/react["']/.test(source)) {
    problems.push(`${rel}: uses motion.* (it bundles the features); use m.* from motion/react-m`);
  }
  if (/\b(LazyMotion|MotionConfig)\b/.test(source) && rel !== "components/ui/motion.tsx") problems.push(`${rel}: a second LazyMotion or MotionConfig`);
  return problems;
}

describe("motion/react (D51)", () => {
  it("is used only in client components, through m.* and one provider", () => {
    const users = sourceFiles().filter(({ source }) => MOTION_IMPORT.test(source));
    expect(users.map(({ rel }) => rel).sort()).toEqual(
      expect.arrayContaining(["components/ui/motion-features.ts", "components/ui/motion.tsx", "components/ui/toast.tsx"]),
    );
    expect(users.flatMap(({ rel, source }) => motionProblems(rel, source))).toEqual([]);
  });

  it("catches each misuse (negative control)", () => {
    expect(motionProblems("x.tsx", 'import { m } from "motion/react";')).toEqual(['x.tsx: imports motion without "use client"']);
    expect(motionProblems("x.tsx", '"use client";\nimport { motion } from "motion/react";')).toEqual([
      "x.tsx: uses motion.* (it bundles the features); use m.* from motion/react-m",
    ]);
    expect(motionProblems("x.tsx", '"use client";\nimport { motion as x } from "framer-motion";')).toEqual([
      "x.tsx: imports framer-motion or motion/react-client",
    ]);
    expect(motionProblems("x.tsx", '"use client";\nimport { LazyMotion } from "motion/react";')).toEqual(["x.tsx: a second LazyMotion or MotionConfig"]);
    expect(motionProblems("x.tsx", '"use client";\nimport * as m from "motion/react-m";\n<m.div />')).toEqual([]);
  });

  it("loads the animation features only with import() from the provider, under the protected layout", () => {
    const files = sourceFiles();
    const provider = files.find(({ rel }) => rel === "components/ui/motion.tsx")!.source;
    expect(provider).toMatch(/import\(\s*["']\.\/motion-features["']\s*\)/);
    expect(provider).toMatch(/<LazyMotion features=\{loadFeatures\} strict>/);
    const others = files.filter(({ rel }) => rel !== "components/ui/motion.tsx" && rel !== "components/ui/motion-features.ts");
    expect(others.filter(({ source }) => /motion-features|\bdom(Animation|Max|Min)\b/.test(source)).map(({ rel }) => rel)).toEqual([]);
    const layout = files.find(({ rel }) => rel === "app/(protected)/layout.tsx")!.source;
    expect(layout).toMatch(/<MotionProvider>\s*<ToastProvider>/);
  });

  it("uses the D40 durations and easing of globals.css", () => {
    const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf-8");
    const ms = (name: string) => Number(css.match(new RegExp(`--motion-${name}:\\s*(\\d+)ms`))![1]) / 1000;
    expect(MOTION_SECONDS).toEqual({ fast: ms("fast"), base: ms("base"), slow: ms("slow") });
    const ease = css.match(/--ease-standard:\s*cubic-bezier\(([^)]+)\)/)![1].split(",").map(Number);
    expect([...EASE_STANDARD]).toEqual(ease);
  });
});
