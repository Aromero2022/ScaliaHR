// D36: whether a pull request's k6 run is compared with main's median.
// The CI step pipes `git diff -z --name-only --no-renames HEAD^1 HEAD` of the
// pull request's merge commit into this script. When every path is Markdown,
// under docs/ or under .claude/, the images are main's, so the comparison does
// not apply; k6 still runs and its own p95 < 500 ms threshold still gates.
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** True for a path the comparison ignores: any `*.md`, or anything under `docs/` or `.claude/`. */
export function exemptFromComparison(file) {
  return file.endsWith(".md") || file.startsWith("docs/") || file.startsWith(".claude/");
}

/**
 * Splits NUL-separated paths (`git diff -z`). Throws when the input does not
 * end in NUL: without -z, "apps/a.ts\ndocs/b.md" would read as one Markdown path.
 */
export function parsePaths(input) {
  if (input === "") return [];
  if (!input.endsWith("\0")) throw new Error("expected NUL-separated paths from git diff -z");
  return input.slice(0, -1).split("\0");
}

/** The files that keep the comparison in force; none means it does not apply. */
export function comparisonScope(files) {
  const counted = files.filter((file) => !exemptFromComparison(file));
  return { applies: counted.length > 0, counted, total: files.length };
}

const SHOWN = 20;

function main() {
  let files;
  try {
    files = parsePaths(readFileSync(0, "utf-8"));
  } catch (error) {
    console.error(`::error::D36: ${error.message}`);
    process.exit(1);
  }
  const { applies, counted, total } = comparisonScope(files);
  const verdict = applies
    ? "D36 comparison with main's median: applies."
    : "D36 comparison with main's median: not applicable (no changes in the images). k6 still runs and its p95 < 500 ms threshold still gates.";
  if (applies) {
    console.log(`The diff against main changes ${counted.length} of ${total} files outside **/*.md, docs/** and .claude/**:`);
    // Quoted, so a file name never starts a line with "::" (a workflow command).
    for (const file of counted.slice(0, SHOWN)) console.log(`- ${JSON.stringify(file)}`);
    if (counted.length > SHOWN) console.log(`- ...and ${counted.length - SHOWN} more`);
  } else {
    console.log(`The diff against main only touches **/*.md, docs/** or .claude/** (${total} files).`);
  }
  console.log(verdict);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${verdict}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
