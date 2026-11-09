// D44: axe policy. A scan fails on any violation of a rule tagged with one of
// WCAG_TAGS (the goal is WCAG 2.2 AA). Best-practice rules run too, and their
// findings are listed in the report without failing. No rule is disabled and
// nothing is excluded from a scan.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { artifactsDir } from "./env";

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

type AxeResult = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number];

/**
 * What the report keeps of a result: the rule and the CSS selectors of the
 * nodes, never their HTML or text, which could carry what is on screen.
 */
function summarize(results: AxeResult[]) {
  return results.map((r) => ({
    id: r.id,
    impact: r.impact ?? null,
    tags: r.tags,
    help: r.help,
    helpUrl: r.helpUrl,
    nodes: r.nodes.map((n) => ({ target: n.target.map(String), failureSummary: n.failureSummary ?? "" })),
  }));
}

export const isWcag = (tags: readonly string[]) => tags.some((tag) => (WCAG_TAGS as readonly string[]).includes(tag));

export function axeResultsFile(): string {
  return path.join(artifactsDir(), "axe", "axe-results.jsonl");
}

/** Scans the page as it is now (dialogs open included) and fails on any WCAG violation. */
export async function expectNoWcagViolations(page: Page, scan: string): Promise<void> {
  // Next.js streams the metadata of a dynamic page: after a client-side
  // navigation the <title> arrives a moment after the content. A page that
  // never gets one still fails here, by timeout.
  await page.waitForFunction(() => document.title.trim() !== "", undefined, { timeout: 10_000 });
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS, "best-practice"]).analyze();
  const failing = results.violations.filter((v) => isWcag(v.tags));
  const bestPractice = results.violations.filter((v) => !isWcag(v.tags));
  const theme = await page.evaluate(() => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const viewport = page.viewportSize();
  const entry = {
    scan,
    path: new URL(page.url()).pathname,
    theme,
    width: viewport?.width ?? null,
    axe: results.testEngine.version,
    passes: results.passes.length,
    violations: summarize(failing),
    bestPractice: summarize(bestPractice),
    incomplete: summarize(results.incomplete.filter((r) => isWcag(r.tags))),
  };
  mkdirSync(path.dirname(axeResultsFile()), { recursive: true });
  appendFileSync(axeResultsFile(), `${JSON.stringify(entry)}\n`);
  const message = failing.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`).join("\n");
  expect(failing.length, `axe WCAG violations in "${scan}":\n${message}`).toBe(0);
}
