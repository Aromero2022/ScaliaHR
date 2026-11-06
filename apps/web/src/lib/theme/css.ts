// D40 — renders a preset as the --theme-* variables that globals.css maps to
// the Tailwind utilities. Every value is checked against a strict format first:
// a theme is data, never a stylesheet (D18), and in Phase 11 tenant values go
// through this same function.
import { deriveHighContrast } from "./high-contrast";
import {
  COLOR_TOKENS,
  type ColorSet,
  FONT_STACKS,
  RADIUS_TOKENS,
  type RadiusSet,
  SHADOW_TOKENS,
  type ShadowSet,
  TRANSLUCENT_TOKENS,
  type ThemePreset,
} from "./tokens";

const OPAQUE = /^#[0-9a-f]{6}$/i;
const TRANSLUCENT = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const LENGTH = /^(0|\d{1,3}(\.\d{1,4})?(rem|px))$/;
const SHADOW = /^(inset )?-?\d{1,3}(px)?( -?\d{1,3}(px)?){1,3} #[0-9a-f]{6}([0-9a-f]{2})?$/i;

export class ThemeValueError extends Error {}

function check(name: string, value: string, format: RegExp): string {
  if (typeof value !== "string" || !format.test(value)) {
    throw new ThemeValueError(`invalid theme value for ${name}: ${JSON.stringify(value)}`);
  }
  return value;
}

function colorVars(colors: ColorSet): string {
  return COLOR_TOKENS.map((token) => {
    const format = TRANSLUCENT_TOKENS.includes(token) ? TRANSLUCENT : OPAQUE;
    return `--theme-${token}:${check(token, colors[token], format)};`;
  }).join("");
}

function shadowVars(shadows: ShadowSet): string {
  return SHADOW_TOKENS.map((token) => {
    const value = shadows[token];
    value.split(", ").forEach((part) => check(`shadow-${token}`, part, SHADOW));
    return `--theme-shadow-${token}:${value};`;
  }).join("");
}

function radiusVars(radius: RadiusSet): string {
  return RADIUS_TOKENS.map((token) => `--theme-radius-${token}:${check(`radius-${token}`, radius[token], LENGTH)};`).join("");
}

/**
 * CSS for one preset: light by default, dark for data-theme="dark" (or
 * "system" with a dark OS), high contrast for data-contrast="more" (or "auto"
 * with prefers-contrast: more). Later rules win where both apply.
 */
export function themeCss(preset: ThemePreset): string {
  const font = FONT_STACKS[preset.font];
  if (!font) throw new ThemeValueError(`unknown font: ${JSON.stringify(preset.font)}`);
  const light = `color-scheme:light;${colorVars(preset.light.colors)}${shadowVars(preset.light.shadows)}`;
  const dark = `color-scheme:dark;${colorVars(preset.dark.colors)}${shadowVars(preset.dark.shadows)}`;
  const moreLight = colorVars(deriveHighContrast(preset.light.colors, preset.contrastOverrides?.light));
  const moreDark = colorVars(deriveHighContrast(preset.dark.colors, preset.contrastOverrides?.dark));
  return [
    `:root{--theme-font-sans:${font};${radiusVars(preset.radius)}${light}}`,
    `:root[data-theme="dark"]{${dark}}`,
    `@media (prefers-color-scheme:dark){:root[data-theme="system"]{${dark}}}`,
    `:root[data-contrast="more"]{${moreLight}}`,
    `:root[data-contrast="more"][data-theme="dark"]{${moreDark}}`,
    `@media (prefers-color-scheme:dark){:root[data-contrast="more"][data-theme="system"]{${moreDark}}}`,
    `@media (prefers-contrast:more){:root[data-contrast="auto"]{${moreLight}}:root[data-contrast="auto"][data-theme="dark"]{${moreDark}}}`,
    `@media (prefers-contrast:more) and (prefers-color-scheme:dark){:root[data-contrast="auto"][data-theme="system"]{${moreDark}}}`,
  ].join("\n");
}
