import { describe, expect, it } from "vitest";
import { sourceFiles } from "./source-exports";

/**
 * D43: every modal is the Dialog of components/ui/ (native <dialog>, focus
 * trapped by the browser, Esc, focus returned). A hand-made overlay with
 * `fixed inset-0` outside components/ui/ fails here. One listed exception:
 * the D41 "Más" dialog, which already has role="dialog", aria-modal, a focus
 * trap, Esc and focus return, with its own tests.
 */

const ALLOWED = new Set(["components/navigation/app-navigation.tsx"]);
const OVERLAY = /(?<![\w:-])fixed(?![\w-])[^"'`]*(?<![\w:-])inset-0(?![\w-])|(?<![\w:-])inset-0(?![\w-])[^"'`]*(?<![\w:-])fixed(?![\w-])/;

export function handmadeOverlays(source: string): string[] {
  const strings = source.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [];
  return strings.filter((s) => OVERLAY.test(s));
}

describe("modals are Dialogs (D43)", () => {
  it("no fixed inset-0 overlay outside components/ui/ (except the listed D41 dialog)", () => {
    const hits = sourceFiles()
      .filter(({ rel }) => rel.endsWith(".tsx") && !rel.startsWith("components/ui/") && !ALLOWED.has(rel))
      .flatMap(({ rel, source }) => handmadeOverlays(source).map((s) => `${rel}: ${s.slice(0, 80)}`));
    expect(hits).toEqual([]);
  });

  it("the exception is still the D41 dialog it was granted for", () => {
    const nav = sourceFiles().find(({ rel }) => rel === "components/navigation/app-navigation.tsx")!.source;
    expect(nav).toContain('role="dialog"');
    expect(nav).toContain('aria-modal="true"');
    expect(handmadeOverlays(nav).length).toBeGreaterThan(0);
  });

  it("catches a hand-made overlay and ignores variants that are not one (negative control)", () => {
    expect(handmadeOverlays(`<div className="fixed inset-0 z-50 bg-overlay">`)).toHaveLength(1);
    expect(handmadeOverlays(`<div className={\`inset-0 fixed \${x}\`}>`)).toHaveLength(1);
    expect(handmadeOverlays(`<a className="sr-only focus:fixed focus:top-3">`)).toEqual([]);
    expect(handmadeOverlays(`<div className="absolute inset-0 bg-overlay">`)).toEqual([]);
    expect(handmadeOverlays(`<div className="fixed inset-x-4 top-16">`)).toEqual([]);
  });
});
