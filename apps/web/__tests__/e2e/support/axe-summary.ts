// D44: after the run, the axe scans of axe-results.jsonl become axe-report.json
// and a readable axe-summary.md, both part of the job's artifact.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { axeResultsFile, WCAG_TAGS } from "./axe";

type Node = { target: string[] };
type Rule = { id: string; impact: string | null; help: string; nodes: Node[] };
type Scan = { scan: string; path: string; theme: string; width: number | null; axe: string; passes: number; violations: Rule[]; bestPractice: Rule[]; incomplete: Rule[] };

function byRule(scans: Scan[], pick: (s: Scan) => Rule[]) {
  const rules = new Map<string, { id: string; impact: string | null; help: string; scans: Set<string>; nodes: number }>();
  for (const scan of scans) {
    for (const rule of pick(scan)) {
      const entry = rules.get(rule.id) ?? { id: rule.id, impact: rule.impact, help: rule.help, scans: new Set<string>(), nodes: 0 };
      entry.scans.add(scan.scan);
      entry.nodes += rule.nodes.length;
      rules.set(rule.id, entry);
    }
  }
  return [...rules.values()].map((r) => ({ ...r, scans: [...r.scans].sort() })).sort((a, b) => a.id.localeCompare(b.id));
}

export default async function axeSummary(): Promise<void> {
  const file = axeResultsFile();
  if (!existsSync(file)) return;
  const scans = readFileSync(file, "utf-8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Scan);
  const report = {
    policy: { failsOn: WCAG_TAGS, listedOnly: ["best-practice"], disabledRules: [], exclusions: [] },
    axe: scans[0]?.axe ?? null,
    scans: scans.length,
    pages: [...new Set(scans.map((s) => s.path))].sort(),
    violations: byRule(scans, (s) => s.violations),
    bestPractice: byRule(scans, (s) => s.bestPractice),
    incomplete: byRule(scans, (s) => s.incomplete),
  };
  const dir = path.dirname(file);
  writeFileSync(path.join(dir, "axe-report.json"), JSON.stringify({ ...report, results: scans }, null, 2));
  const table = (rules: ReturnType<typeof byRule>) =>
    rules.length === 0
      ? "Ninguna.\n"
      : ["| Regla | Impacto | Nodos | Escaneos |", "|---|---|---|---|", ...rules.map((r) => `| \`${r.id}\` | ${r.impact ?? "—"} | ${r.nodes} | ${r.scans.length} |`)].join("\n") + "\n";
  const md = [
    "# axe (D44)",
    "",
    `axe-core ${report.axe}. ${report.scans} escaneos sobre ${report.pages.length} rutas, en claro y oscuro, con los diálogos abiertos.`,
    `Fallan: ${WCAG_TAGS.join(", ")}. Sin reglas desactivadas ni exclusiones.`,
    "",
    "## Violaciones WCAG (fallan)",
    table(report.violations),
    "## Buenas prácticas (solo se listan)",
    table(report.bestPractice),
    "## Por revisar a mano (incomplete de axe, WCAG)",
    table(report.incomplete),
  ].join("\n");
  writeFileSync(path.join(dir, "axe-summary.md"), md);
}
