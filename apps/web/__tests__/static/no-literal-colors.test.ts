import { describe, expect, it } from "vitest";
import { COLOR_TOKENS, SOLID_TOKENS } from "@/lib/theme/tokens";
import { sourceFiles } from "./source-exports";

/**
 * D40: components use the semantic tokens only. A new literal color fails
 * here: a Tailwind palette class, an arbitrary color value, a hex or rgb()
 * color, an opacity modifier on a token (its contrast would be untested), a
 * color class built at runtime (Tailwind cannot see it), or a solid accent or
 * state fill whose text is not its on- token. The preset files under
 * lib/theme are where the values live, so they are the only exception.
 */

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";
const COLOR_UTILITY =
  "bg|text|border|border-[trblxy]|ring|ring-offset|outline|divide|placeholder|from|via|to|fill|stroke|shadow|accent|caret|decoration";

const RULES: { name: string; pattern: RegExp }[] = [
  { name: "Tailwind palette class", pattern: new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:${COLOR_UTILITY})-(?:${PALETTE})(?:-\\d{2,3})?(?:/\\d+)?(?![\\w-])`, "g") },
  { name: "arbitrary color value", pattern: new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:${COLOR_UTILITY})-\\[(?:#|rgb|hsl|oklch|oklab|lab|lch|color|var\\()[^\\]]*\\]`, "g") },
  { name: "hex color", pattern: /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g },
  { name: "color function", pattern: /\b(?:rgba?|hsla?|oklch|oklab|hwb)\(/g },
  { name: "opacity modifier on a color token", pattern: new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:${COLOR_UTILITY})-(?:${COLOR_TOKENS.join("|")})/\\d+(?![\\w-])`, "g") },
  { name: "color class built at runtime", pattern: new RegExp(`(?<![\\w-])(?:${COLOR_UTILITY})-\\$\\{`, "g") },
  // Bare rounded/shadow and arbitrary values bypass the radius and shadow tokens.
  { name: "radius or shadow outside the tokens", pattern: /(?<![\w:-])(?:[a-z-]+:)*(?:rounded|shadow)(?:-\[[^\]]*\])?(?=["'`\s])/g },
];

/** Class strings with a solid fill and a text color other than the fill's own. */
function wrongTextOnSolid(source: string): string[] {
  const found: string[] = [];
  for (const literal of source.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? []) {
    for (const solid of SOLID_TOKENS) {
      if (!new RegExp(`(?<![\\w:-])bg-${solid}(?![\\w-])`).test(literal)) continue;
      const texts = literal.match(/(?<![\w:-])text-(?:[a-z0-9-]+)(?![\w-])/g) ?? [];
      const colors = texts.filter((t) => COLOR_TOKENS.includes(t.slice(5) as (typeof COLOR_TOKENS)[number]));
      for (const t of colors) if (t !== `text-on-${solid}`) found.push(`${t} on bg-${solid}`);
    }
  }
  return found;
}

const files = sourceFiles().filter(({ rel }) => !rel.startsWith("lib/theme/"));

// A class that names a token family but no token: Tailwind would emit nothing for it.
const FAMILIES = "canvas|surface|fg|line|control|focus|accent|success|warning|danger|info|category|on|overlay|qr";
const TOKEN_CLASS = new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:${COLOR_UTILITY})-((?:${FAMILIES})(?:-[a-z0-9]+)*)(?![\\w/-])`, "g");

function unknownTokens(source: string): string[] {
  return [...source.matchAll(TOKEN_CLASS)]
    .filter((m) => !COLOR_TOKENS.includes(m[1] as (typeof COLOR_TOKENS)[number]))
    .map((m) => `unknown color token: ${m[0]}`);
}

function violations(source: string): string[] {
  const out = RULES.flatMap(({ name, pattern }) => [...source.matchAll(pattern)].map((m) => `${name}: ${m[0]}`));
  return [...out, ...unknownTokens(source), ...wrongTextOnSolid(source).map((v) => `text on a solid fill: ${v}`)];
}

describe("no literal colors in components (D40)", () => {
  it("catches each kind of literal color", () => {
    const sample = [
      '<div className="bg-slate-800 hover:text-white" />',
      '<div className="text-[#ff0000] bg-[rgb(1,2,3)]" />',
      '<div style={{ color: "#0f172a", background: "rgba(0,0,0,.5)" }} />',
      '<div className="bg-surface/50 text-fg" />',
      "const cls = `bg-${tone}-600`;",
      '<button className="bg-accent text-fg" />',
      '<button className="bg-danger text-on-danger hover:bg-danger-hover" />',
      '<a href="#main" className="text-[10px] w-1/2 bg-accent-subtle text-accent-fg">&#123;</a>',
      '<span className="border-category-2 text-success-light ring-focus" />',
      '<div className="rounded shadow-[0_0_4px_red] rounded-lg shadow-sm" />',
    ].join("\n");
    expect(violations(sample)).toEqual([
      "Tailwind palette class: bg-slate-800",
      "Tailwind palette class: hover:text-white",
      "arbitrary color value: text-[#ff0000]",
      "arbitrary color value: bg-[rgb(1,2,3)]",
      "hex color: #ff0000",
      "hex color: #0f172a",
      "color function: rgb(",
      "color function: rgba(",
      "opacity modifier on a color token: bg-surface/50",
      "color class built at runtime: bg-${",
      "radius or shadow outside the tokens: rounded",
      "radius or shadow outside the tokens: shadow-[0_0_4px_red]",
      "unknown color token: border-category-2",
      "unknown color token: text-success-light",
      "text on a solid fill: text-fg on bg-accent",
    ]);
  });

  it("checks the whole app", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const { rel, source } of files) {
    const found = violations(source);
    if (found.length === 0) continue;
    it(`${rel} uses only semantic color tokens`, () => {
      expect(found).toEqual([]);
    });
  }

  it("every file uses only semantic color tokens", () => {
    const offenders = files.filter(({ source }) => violations(source).length > 0).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
