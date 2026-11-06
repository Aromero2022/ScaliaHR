// D40 — the automatic high-contrast variant of a preset (D18): text at 7:1,
// boundaries and indicators at 4.5:1, tints removed so every label sits on a
// plain surface. A preset may still override single values.
import { contrastRatio, ensureContrast, mix } from "./contrast";
import { type ColorSet, type ColorToken, SOLID_TOKENS, SURFACE_TOKENS, TINTED_FAMILIES, onToken } from "./tokens";

const TEXT = 7;
const BOUNDARY = 4.5;

export function deriveHighContrast(base: ColorSet, overrides: Partial<ColorSet> = {}): ColorSet {
  const c: ColorSet = { ...base };
  const surfaces = () => SURFACE_TOKENS.map((t) => c[t]);

  // Tinted backgrounds become the plain surface, so tints never carry meaning.
  for (const family of TINTED_FAMILIES) c[`${family}-subtle` as ColorToken] = c.surface;

  c.fg = ensureContrast(c.fg, surfaces(), TEXT);
  c["fg-muted"] = c.fg;
  c["fg-subtle"] = c.fg;
  for (const family of TINTED_FAMILIES) {
    const fg = `${family}-fg` as ColorToken;
    c[fg] = ensureContrast(c[fg], surfaces(), TEXT);
    c[`${family}-line` as ColorToken] = c[fg];
  }

  c.control = ensureContrast(c.control, surfaces(), BOUNDARY);
  c.line = c.control;
  c.focus = ensureContrast(c.focus, surfaces(), BOUNDARY);
  c["surface-strong"] = ensureContrast(c["surface-strong"], surfaces(), BOUNDARY);

  for (const solid of SOLID_TOKENS) {
    const on = onToken(solid);
    const fill = ensureContrast(c[solid], surfaces(), BOUNDARY);
    // Black or white text, whichever reads better on the fill; then the fill
    // moves away from the text until the pair reaches 7:1.
    c[on] = contrastRatio("#000000", fill) >= contrastRatio("#ffffff", fill) ? "#000000" : "#ffffff";
    c[solid] = ensureContrast(fill, [c[on]], TEXT);
    const away = c[on] === "#ffffff" ? "#000000" : "#ffffff";
    c[`${solid}-hover` as ColorToken] = ensureContrast(mix(c[solid], away, 0.12), [c[on]], TEXT);
  }

  return { ...c, ...overrides };
}
