// Supabase advisors (security and performance) against the LOCAL database
// must report nothing (D25). Run by CI and by `npm run db:advisors`.
//
// The only lint left out is unused_index: it reads idx_scan statistics, so on
// a freshly migrated database every index looks unused. Index usage is
// reviewed with the k6 load test data instead (Phase 9b).
import { spawnSync } from "node:child_process";

export const IGNORED = new Set(["unused_index"]);

export function findings(output) {
  const start = output.indexOf("{");
  if (start < 0) throw new Error("supabase db advisors printed no JSON");
  const { results } = JSON.parse(output.slice(start));
  return results.filter((r) => !IGNORED.has(r.name));
}

function main() {
  const run = spawnSync(
    "supabase",
    ["db", "advisors", "--local", "--type", "all", "--level", "info", "--output-format", "json"],
    { encoding: "utf-8" },
  );
  if (run.status !== 0) {
    console.error(run.stderr || run.stdout);
    console.error("::error::supabase db advisors failed — is the local stack running?");
    process.exit(1);
  }
  const left = findings(run.stdout);
  if (left.length > 0) {
    for (const r of left) console.error(`::error::${r.level} ${r.name}: ${r.detail}`);
    console.error(`${left.length} advisor finding(s). Fix them in a migration (see docs/ARCHITECTURE.md, D25).`);
    process.exit(1);
  }
  console.log("Supabase advisors: no findings (unused_index excluded on a fresh database).");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
