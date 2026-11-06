import { describe, expect, it } from "vitest";
import { contrastFailures, contrastPairs, contrastRatio, ensureContrast, mix } from "@/lib/theme/contrast";
import { deriveHighContrast } from "@/lib/theme/high-contrast";
import { clean } from "@/lib/theme/presets/clean";
import { COLOR_TOKENS, type ThemePreset, TRANSLUCENT_TOKENS } from "@/lib/theme/tokens";

/**
 * D40: every text/background pair of the tokens reaches 4.5:1 and every
 * boundary, focus and indicator 3:1, in light, dark and both high-contrast
 * variants (7:1 and 4.5:1 there). A new preset joins PRESETS and is checked
 * the same way.
 */

const PRESETS: ThemePreset[] = [clean];

const report = (failures: ReturnType<typeof contrastFailures>) =>
  failures.map((f) => `${f.fg} on ${f.bg}: ${f.ratio.toFixed(2)} < ${f.min}`);

describe("contrast math (WCAG 2.2)", () => {
  it("matches the reference ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#4f46e5", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#4f46e5"), 10);
  });

  it("moves a color only as far as the ratio needs, and refuses an impossible one", () => {
    expect(ensureContrast("#000000", ["#ffffff"], 4.5)).toBe("#000000");
    const fixed = ensureContrast("#9ca3af", ["#ffffff"], 4.5);
    expect(contrastRatio(fixed, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(mix(fixed, "#ffffff", 0.02), "#ffffff")).toBeLessThan(4.6);
    expect(() => ensureContrast("#777777", ["#000000", "#ffffff"], 15)).toThrow(/reaches 15:1/);
  });

  it("covers every text color on every surface it can sit on", () => {
    const pairs = contrastPairs();
    expect(pairs.filter((p) => p.kind === "text").length).toBeGreaterThan(60);
    expect(pairs).toContainEqual({ fg: "fg-subtle", bg: "surface-hover", min: 4.5, kind: "text" });
    expect(pairs).toContainEqual({ fg: "on-accent", bg: "accent-hover", min: 4.5, kind: "text" });
    expect(pairs).toContainEqual({ fg: "focus", bg: "surface-raised", min: 3, kind: "component" });
    expect(pairs.some((p) => TRANSLUCENT_TOKENS.includes(p.fg) || TRANSLUCENT_TOKENS.includes(p.bg))).toBe(false);
  });
});

for (const preset of PRESETS) {
  describe(`preset ${preset.label}`, () => {
    it("defines every token in both modes", () => {
      for (const mode of [preset.light, preset.dark]) expect(Object.keys(mode.colors).sort()).toEqual([...COLOR_TOKENS].sort());
    });

    for (const [name, colors, high] of [
      ["light", preset.light.colors, false],
      ["dark", preset.dark.colors, false],
      ["high-contrast light", deriveHighContrast(preset.light.colors, preset.contrastOverrides?.light), true],
      ["high-contrast dark", deriveHighContrast(preset.dark.colors, preset.contrastOverrides?.dark), true],
    ] as const) {
      it(`${name}: text 4.5:1 and components 3:1${high ? " (raised to 7:1 and 4.5:1)" : ""}`, () => {
        expect(report(contrastFailures(colors, high))).toEqual([]);
      });
    }
  });
}
