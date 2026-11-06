// D40 — WCAG 2.2 contrast for the theme tokens: the ratio itself, the pairs
// every preset must pass, and the adjustment the high-contrast variant (and,
// in Phase 11, a tenant's brand colors) uses to reach a ratio.
import { type ColorSet, type ColorToken, SOLID_TOKENS, SURFACE_TOKENS, TINTED_FAMILIES, onToken } from "./tokens";

const HEX = /^#([0-9a-f]{6})$/i;

function channels(hex: string): [number, number, number] {
  const m = HEX.exec(hex);
  if (!m) throw new Error(`not an opaque #rrggbb color: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance of an opaque sRGB color. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mixes `hex` toward `target` by `amount` (0–1) in sRGB. */
export function mix(hex: string, target: string, amount: number): string {
  const a = channels(hex);
  const b = channels(target);
  return `#${a.map((c, i) => Math.round(c + (b[i] - c) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The color closest to `hex` (mixed toward black or white, whichever needs
 * less change) whose contrast against every background reaches `ratio`.
 * Throws when neither direction can reach it.
 */
export function ensureContrast(hex: string, backgrounds: readonly string[], ratio: number): string {
  const passes = (c: string) => backgrounds.every((bg) => contrastRatio(c, bg) >= ratio);
  if (passes(hex)) return hex;
  for (let step = 1; step <= 100; step++) {
    for (const target of ["#000000", "#ffffff"]) {
      const candidate = mix(hex, target, step / 100);
      if (passes(candidate)) return candidate;
    }
  }
  throw new Error(`no color near ${hex} reaches ${ratio}:1 against ${backgrounds.join(", ")}`);
}

export interface ContrastPair {
  fg: ColorToken;
  bg: ColorToken;
  min: number;
  kind: "text" | "component";
}

const TEXT_TOKENS: ColorToken[] = [
  "fg",
  "fg-muted",
  "fg-subtle",
  ...TINTED_FAMILIES.map((f) => `${f}-fg` as ColorToken),
];

const INDICATORS: ColorToken[] = ["control", "focus", "surface-strong", ...SOLID_TOKENS];

/** Surfaces an indicator rests on. The hover background is transient and only carries text. */
const RESTING_SURFACES = SURFACE_TOKENS.filter((t) => t !== "surface-hover");

/**
 * Every pair a preset must pass (D40). `text` pairs need 4.5:1 and
 * `component` pairs (boundaries, focus and indicators) 3:1; the high-contrast
 * variant raises them to 7:1 and 4.5:1.
 */
export function contrastPairs(): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  const text = (fg: ColorToken, bg: ColorToken) => pairs.push({ fg, bg, min: 4.5, kind: "text" });
  for (const fg of TEXT_TOKENS) for (const bg of SURFACE_TOKENS) text(fg, bg);
  for (const family of TINTED_FAMILIES) {
    const subtle = `${family}-subtle` as ColorToken;
    for (const fg of [`${family}-fg` as ColorToken, "fg", "fg-muted"] as ColorToken[]) text(fg, subtle);
  }
  for (const solid of SOLID_TOKENS) {
    text(onToken(solid), solid);
    text(onToken(solid), `${solid}-hover` as ColorToken);
  }
  for (const fg of INDICATORS) {
    for (const bg of RESTING_SURFACES) pairs.push({ fg, bg, min: 3, kind: "component" });
  }
  return pairs;
}

export const HIGH_CONTRAST_MIN = { text: 7, component: 4.5 } as const;

/** Pairs below their minimum in a color set; empty when the set passes. */
export function contrastFailures(colors: ColorSet, highContrast = false) {
  return contrastPairs()
    .map((p) => ({ ...p, min: highContrast ? HIGH_CONTRAST_MIN[p.kind] : p.min }))
    .map((p) => ({ ...p, ratio: contrastRatio(colors[p.fg], colors[p.bg]) }))
    .filter((p) => p.ratio < p.min);
}
