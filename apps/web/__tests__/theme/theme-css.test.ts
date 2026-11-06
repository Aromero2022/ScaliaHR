import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRAST_STORAGE_KEY, THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/theme/boot-script";
import { ThemeValueError, themeCss } from "@/lib/theme/css";
import { deriveHighContrast } from "@/lib/theme/high-contrast";
import { DEFAULT_THEME_ATTRIBUTES, DEFAULT_THEME_CSS } from "@/lib/theme";
import { clean } from "@/lib/theme/presets/clean";
import { COLOR_TOKENS, RADIUS_TOKENS, SHADOW_TOKENS, type ThemePreset } from "@/lib/theme/tokens";

/** D40: how a preset becomes CSS, what the boot script may change, and the Tailwind contract. */

const withColor = (token: string, value: string): ThemePreset => ({
  ...clean,
  light: { ...clean.light, colors: { ...clean.light.colors, [token]: value } },
});

describe("themeCss (D40)", () => {
  const css = themeCss(clean);

  it("renders every token for light, dark and both high-contrast variants", () => {
    // light; dark for data-theme=dark and for system on a dark OS; high contrast
    // light and dark for data-contrast=more (3 blocks) and for auto with prefers-contrast (3 more).
    for (const token of COLOR_TOKENS) {
      expect(css.match(new RegExp(`--theme-${token}:`, "g"))?.length).toBe(9);
    }
    for (const token of RADIUS_TOKENS) expect(css).toContain(`--theme-radius-${token}:`);
    for (const token of SHADOW_TOKENS) expect(css).toContain(`--theme-shadow-${token}:`);
    expect(css).toContain("--theme-font-sans:var(--font-inter)");
  });

  it("selects the mode with data-theme and the contrast with data-contrast, falling back to the OS", () => {
    expect(css).toContain(`:root[data-theme="dark"]{color-scheme:dark;`);
    expect(css).toContain(`@media (prefers-color-scheme:dark){:root[data-theme="system"]{color-scheme:dark;`);
    expect(css).toContain(`:root[data-contrast="more"]{`);
    expect(css).toContain(`@media (prefers-contrast:more){:root[data-contrast="auto"]{`);
    expect(css).toContain(`@media (prefers-contrast:more) and (prefers-color-scheme:dark){:root[data-contrast="auto"][data-theme="system"]{`);
    const darkFg = clean.dark.colors.fg;
    const moreDarkFg = deriveHighContrast(clean.dark.colors).fg;
    expect(css).toContain(`--theme-fg:${darkFg};`);
    expect(css).toContain(`--theme-fg:${moreDarkFg};`);
  });

  it("is what the app renders by default", () => {
    expect(DEFAULT_THEME_CSS).toBe(css);
    expect(DEFAULT_THEME_ATTRIBUTES).toEqual({ "data-preset": "clean", "data-theme": "system", "data-contrast": "auto" });
  });

  it("refuses any value that is not a plain color, length or shadow (a theme is data, D18)", () => {
    for (const bad of ["red", "#fff", "#ffffff;}body{display:none", "url(https://x.test/a.png)", "#ffffff80", ""]) {
      expect(() => themeCss(withColor("fg", bad)), bad).toThrow(ThemeValueError);
    }
    expect(() => themeCss(withColor("overlay", "#00000099"))).not.toThrow();
    expect(() => themeCss({ ...clean, radius: { ...clean.radius, lg: "1rem;}html{color:red" } })).toThrow(ThemeValueError);
    expect(() =>
      themeCss({ ...clean, dark: { ...clean.dark, shadows: { ...clean.dark.shadows, sm: "0 1px 2px #000000; background:red" } } }),
    ).toThrow(ThemeValueError);
    expect(() => themeCss({ ...clean, font: "comic" as ThemePreset["font"] })).toThrow(ThemeValueError);
  });
});

describe("Tailwind contract in globals.css (D40)", () => {
  const globals = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf-8");

  it("drops the default palette", () => {
    expect(globals).toMatch(/--color-\*:\s*initial;/);
  });

  it("maps exactly the theme tokens, each to its --theme-* variable", () => {
    const mapped = [...globals.matchAll(/--color-([a-z0-9-]+):\s*var\(--theme-([a-z0-9-]+)\);/g)];
    expect(mapped.map((m) => m[1]).sort()).toEqual([...COLOR_TOKENS].sort());
    for (const m of mapped) expect(m[2]).toBe(m[1]);
    for (const t of RADIUS_TOKENS) expect(globals).toContain(`--radius-${t}: var(--theme-radius-${t});`);
    for (const t of SHADOW_TOKENS) expect(globals).toContain(`--shadow-${t}: var(--theme-shadow-${t});`);
    expect(globals).toContain("--font-sans: var(--theme-font-sans);");
  });

  it("drops motion to zero for prefers-reduced-motion and keeps a visible focus", () => {
    expect(globals).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*:root\s*{[^}]*--motion-base: 0ms;/);
    expect(globals).toMatch(/:focus-visible\s*{\s*outline: 2px solid var\(--theme-focus\);/);
  });
});

describe("theme boot script (D40)", () => {
  type Stored = Record<string, string | null>;
  function run(stored: Stored | "throws") {
    const attributes: Record<string, string> = { "data-theme": "system", "data-contrast": "auto" };
    const localStorage = {
      getItem(key: string) {
        if (stored === "throws") throw new Error("blocked");
        return stored[key] ?? null;
      },
    };
    const document = { documentElement: { setAttribute: (k: string, v: string) => (attributes[k] = v) } };
    new Function("window", "document", THEME_BOOT_SCRIPT)({ localStorage }, document);
    return attributes;
  }

  it("applies a stored choice before the first paint", () => {
    expect(run({ [THEME_STORAGE_KEY]: "dark", [CONTRAST_STORAGE_KEY]: "more" })).toEqual({
      "data-theme": "dark",
      "data-contrast": "more",
    });
  });

  it("ignores anything outside the listed values and survives blocked storage", () => {
    expect(run({ [THEME_STORAGE_KEY]: '"><script>', [CONTRAST_STORAGE_KEY]: "less" })).toEqual({
      "data-theme": "system",
      "data-contrast": "auto",
    });
    expect(run({})).toEqual({ "data-theme": "system", "data-contrast": "auto" });
    expect(run("throws")).toEqual({ "data-theme": "system", "data-contrast": "auto" });
  });

  it("is small and touches nothing but the two attributes", () => {
    expect(THEME_BOOT_SCRIPT.length).toBeLessThan(400);
    expect(THEME_BOOT_SCRIPT).not.toMatch(/innerHTML|eval|fetch|cookie|src=/);
  });
});
