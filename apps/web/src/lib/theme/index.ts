// D40 — the theme the app renders today: Clean for every tenant. Phase 11
// picks the tenant's preset (and its validated brand values) here.
import { themeCss } from "./css";
import { clean } from "./presets/clean";

export const DEFAULT_PRESET = clean;
export const DEFAULT_THEME_CSS = themeCss(clean);

/** Attributes the server renders on <html>; the boot script may replace the last two. */
export const DEFAULT_THEME_ATTRIBUTES = {
  "data-preset": clean.id,
  "data-theme": "system",
  "data-contrast": "auto",
} as const;

export { THEME_BOOT_SCRIPT } from "./boot-script";
