import { describe, expect, it } from "vitest";
import { sourceFiles } from "./source-exports";
import { visibleTexts } from "./visible-texts";

/**
 * D42: the interface is in es-MX. This walks every source file with the
 * TypeScript parser and reads only what a user can see: JSX text, the visible
 * attributes (label, placeholder, title, alt, aria-label), string values of
 * visible properties (label, title, description, friendlyName, error…) and
 * every string of the messages module. It fails on English texts that were
 * on screen before D42. Code such as .eq("status", "ACTIVE"), a comparison
 * or an <option value> is not visible text and does not count.
 */

const KNOWN_ENGLISH = [
  "Sign In",
  "Sign in",
  "Signing in",
  "Password",
  "ACTIVE",
  "ON TRACK",
  "ON_TRACK",
  "Performance Score",
  "Potential Score",
  "Employee ID",
  "To Be Hired",
  "Authenticator App",
  "Enterprise Human Capital Management",
  "Enterprise HCM",
  "Talent Review",
  "Position Management",
  "QR Code",
  // D43: the old menu and page names.
  "Admin Center",
  "Talent Hub",
  "Role-Based Permissions",
];
const ENGLISH = KNOWN_ENGLISH.map((text) => ({
  text,
  pattern: new RegExp(`(?<![\\w])${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`),
}));

export function englishIn(texts: string[]): string[] {
  return texts.flatMap((text) => ENGLISH.filter(({ pattern }) => pattern.test(text)).map(({ text: word }) => `${word} → "${text.slice(0, 60)}"`));
}

describe("interface texts are in Spanish (D42)", () => {
  it("no source file shows a known English text", () => {
    const hits = sourceFiles().flatMap(({ rel, source }) =>
      englishIn(visibleTexts(source, rel, rel.startsWith("lib/i18n/"))).map((hit) => `${rel}: ${hit}`),
    );
    expect(hits).toEqual([]);
  });

  it("finds English wherever a user would see it (negative control)", () => {
    const source = `
      export const metadata = { title: "Scalia HR — Enterprise HCM" };
      const t = { label: "Employee ID" };
      export function Page({ loading, status }: { loading: boolean; status: string }) {
        return (
          <form>
            <h2>Sign in to your account</h2>
            <input placeholder="Password" />
            <Field label="Performance Score" value="1" />
            <button>{loading ? "Signing in..." : "Sign In"}</button>
            <span>{\`Status: \${status === "x" ? "ACTIVE" : "ON TRACK"}\`}</span>
            <img alt="QR Code" />
          </form>
        );
      }
      enroll({ factorType: "totp", friendlyName: "Authenticator App" });
    `;
    expect(englishIn(visibleTexts(source, "fixture.tsx")).map((hit) => hit.split(" → ")[0]).sort()).toEqual(
      ["ACTIVE", "Authenticator App", "Employee ID", "Enterprise HCM", "ON TRACK", "Password", "Performance Score", "QR Code", "Sign In", "Sign in", "Signing in"].sort(),
    );
    expect(englishIn(visibleTexts(`export const m = { a: "Sign In" };`, "lib/i18n/x.ts", true))).toHaveLength(1);
  });

  it("does not count code, comparisons, option values or product names", () => {
    const source = `
      import { x } from "Sign In";
      const rows = query.eq("status", "ACTIVE");
      const isActive = status === "ACTIVE";
      const map: Record<string, string> = { ACTIVE: "bg-success" };
      export function Page() {
        return (
          <select className="Password" data-state="ACTIVE">
            <option value="ACTIVE">Activo</option>
            <p>Usa Google Authenticator, Authy o 1Password.</p>
            {labels["ON_TRACK"]}
          </select>
        );
      }
    `;
    expect(englishIn(visibleTexts(source, "fixture.tsx"))).toEqual([]);
  });
});
