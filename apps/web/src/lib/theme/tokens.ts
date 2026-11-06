// D40 — the semantic tokens every component uses. A preset (presets/*.ts) gives
// each of them a value per mode; themeCss() renders them as --theme-* variables
// and globals.css maps the Tailwind utilities (bg-surface, text-fg…) to them.

const STATES = ["success", "warning", "danger", "info"] as const;
const CATEGORIES = ["category-1", "category-2", "category-3"] as const;

export const SURFACE_TOKENS = ["canvas", "surface", "surface-muted", "surface-raised", "surface-hover"] as const;

export const COLOR_TOKENS = [
  ...SURFACE_TOKENS,
  "surface-strong",
  "overlay",
  "qr-surface",
  "fg",
  "fg-muted",
  "fg-subtle",
  "line",
  "control",
  "focus",
  "accent",
  "accent-hover",
  "accent-fg",
  "accent-subtle",
  "accent-line",
  "on-accent",
  ...STATES.flatMap((s) => [s, `${s}-hover`, `${s}-fg`, `${s}-subtle`, `${s}-line`, `on-${s}`] as const),
  ...CATEGORIES.flatMap((c) => [`${c}-fg`, `${c}-subtle`, `${c}-line`] as const),
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
export type ColorSet = Record<ColorToken, string>;

/** Colors with a solid fill and their own text color: the accent and the states. */
export const SOLID_TOKENS = ["accent", ...STATES] as const;
export type SolidToken = (typeof SOLID_TOKENS)[number];
export const onToken = (solid: SolidToken) => `on-${solid}` as ColorToken;

/** Token families with a text color and a tinted background. */
export const TINTED_FAMILIES = ["accent", ...STATES, ...CATEGORIES] as const;

/** The only token that may be translucent (a modal backdrop). */
export const TRANSLUCENT_TOKENS: readonly ColorToken[] = ["overlay"];

export const RADIUS_TOKENS = ["xs", "sm", "md", "lg", "xl", "2xl"] as const;
export const SHADOW_TOKENS = ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"] as const;

export type RadiusSet = Record<(typeof RADIUS_TOKENS)[number], string>;
export type ShadowSet = Record<(typeof SHADOW_TOKENS)[number], string>;

/** Fonts a preset may pick: a closed list of OFL families, self-hosted with next/font (D18). */
export const FONT_STACKS = {
  inter: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
} as const;
export type FontId = keyof typeof FONT_STACKS;

export interface ThemePreset {
  id: string;
  label: string;
  font: FontId;
  radius: RadiusSet;
  light: { colors: ColorSet; shadows: ShadowSet };
  dark: { colors: ColorSet; shadows: ShadowSet };
  /** Optional values that replace the derived high-contrast ones (D18: the variant is automatic). */
  contrastOverrides?: { light?: Partial<ColorSet>; dark?: Partial<ColorSet> };
}

export const THEME_MODES = ["light", "dark", "system"] as const;
export const CONTRAST_MODES = ["auto", "more"] as const;
