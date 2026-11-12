import { afterAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { comparisonScope, exemptFromComparison, parsePaths } from "../../../../scripts/k6-comparison-scope.mjs";

/**
 * D36: a pull request whose diff against main only touches Markdown files, docs/
 * or .claude/ still runs k6, but is not compared with main's median. The CI step
 * is run here as written in ci.yml, on a merge commit built like GitHub's.
 */

const REPO = path.resolve(__dirname, "../../../..");
const SCRIPT = path.join(REPO, "scripts/k6-comparison-scope.mjs");
const CI = readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf-8");
const STEP = "Does the diff change the images? (D36)";
const NOT_APPLICABLE = "D36 comparison with main's median: not applicable (no changes in the images).";
const APPLIES = "D36 comparison with main's median: applies.";

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

/** The docker job, split into its steps (each starts with "      - "). */
function dockerSteps(): string[] {
  const start = CI.indexOf("\n  docker:\n");
  if (start === -1) throw new Error("no docker job in ci.yml");
  const rest = CI.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  const job = next === -1 ? rest : rest.slice(0, next + 1);
  return job.split("\n      - ").slice(1);
}
const stepNamed = (name: string) => {
  const step = dockerSteps().find((s) => s.includes(`name: ${name}`));
  if (!step) throw new Error(`no step "${name}" in the docker job`);
  return step;
};
/** The step's `run: |` block, dedented. */
function runBlock(step: string): string {
  const lines = step.split("\n");
  const start = lines.findIndex((line) => line.trim() === "run: |");
  if (start === -1) throw new Error("the step has no `run: |` block");
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

describe("which paths the comparison ignores (D36)", () => {
  it.each([
    "CLAUDE.md",
    "docs/ARCHITECTURE.md",
    "docs/images/screen.png",
    "docs/a/b.ts",
    ".claude/agents/planner.md",
    ".claude/settings.json",
    "apps/web/src/fonts/inter/README.md",
  ])("ignores %s", (file) => {
    expect(exemptFromComparison(file)).toBe(true);
  });

  it.each([
    "README.MD",
    "x.md.ts",
    "docsx/a.ts",
    "apps/docs/a.ts",
    ".claude",
    ".dockerignore",
    ".github/workflows/ci.yml",
    "apps/web/src/app/page.tsx",
    "load/pages.js",
    "scripts/load-test.sh",
    "supabase/migrations/20260101000000_x.sql",
  ])("counts %s", (file) => {
    expect(exemptFromComparison(file)).toBe(false);
  });

  it("applies when one file counts, and not for an empty diff", () => {
    expect(comparisonScope(["docs/a.md", "apps/web/src/a.ts"])).toEqual({ applies: true, counted: ["apps/web/src/a.ts"], total: 2 });
    expect(comparisonScope(["docs/a.md", "CLAUDE.md"])).toEqual({ applies: false, counted: [], total: 2 });
    expect(comparisonScope([])).toEqual({ applies: false, counted: [], total: 0 });
  });

  it("reads only NUL-separated paths", () => {
    expect(parsePaths("")).toEqual([]);
    expect(parsePaths("docs/a b.md\0apps/x\ny.ts\0")).toEqual(["docs/a b.md", "apps/x\ny.ts"]);
    // Without git diff -z, "apps/a.ts\ndocs/b.md" would read as one Markdown path.
    expect(() => parsePaths("apps/a.ts\ndocs/b.md")).toThrow(/NUL/);
    expect(() => parsePaths("apps/a.ts\0docs/b.md")).toThrow(/NUL/);
  });
});

describe("scripts/k6-comparison-scope.mjs (D36)", () => {
  const run = (input: string, summary?: string) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.GITHUB_STEP_SUMMARY;
    if (summary) env.GITHUB_STEP_SUMMARY = summary;
    return spawnSync("node", [SCRIPT], { input, encoding: "utf-8", env });
  };

  it("says not applicable for docs, Markdown and .claude only, also in the job summary", () => {
    const summary = path.join(tempDir("d36-summary-"), "summary.md");
    const result = run("docs/a.md\0CLAUDE.md\0.claude/settings.json\0", summary);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(NOT_APPLICABLE);
    expect(result.stdout).toContain("(3 files)");
    expect(readFileSync(summary, "utf-8")).toContain(NOT_APPLICABLE);
  });

  it("says applies and lists the files that count, quoted", () => {
    const result = run("docs/a.md\0::error::evil.ts\0apps/web/src/a.ts\0");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(APPLIES);
    expect(result.stdout).toContain('- "apps/web/src/a.ts"');
    expect(result.stdout).not.toContain("docs/a.md");
    // A file name never starts a line with "::", which would be a workflow command.
    expect(result.stdout.split("\n").some((line) => line.startsWith("::"))).toBe(false);
  });

  it("lists at most 20 files", () => {
    const files = Array.from({ length: 25 }, (_, i) => `apps/web/src/f${i}.ts\0`).join("");
    const result = run(files);
    expect(result.stdout).toContain("changes 25 of 25 files");
    expect(result.stdout).toContain("- ...and 5 more");
    expect(result.stdout).not.toContain("f20.ts");
  });

  it("fails on input that is not NUL-separated", () => {
    const result = run("apps/a.ts\ndocs/b.md\n");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("::error::D36: expected NUL-separated paths");
    expect(result.stdout).toBe("");
  });
});

// Each case builds and clones a git repository, so it gets more than the
// default 5 s when the whole suite runs in parallel.
describe("the CI step on a merge commit like GitHub's (D36)", { timeout: 20_000 }, () => {
  const step = stepNamed(STEP);
  const script = runBlock(step);
  // GIT_DIR, GIT_INDEX_FILE and the like (set inside a git hook) would point
  // git at this repository instead of the temporary ones.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))) as NodeJS.ProcessEnv;
  const gitEnv: NodeJS.ProcessEnv = {
    ...inherited,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "ci",
    GIT_AUTHOR_EMAIL: "ci@example.test",
    GIT_COMMITTER_NAME: "ci",
    GIT_COMMITTER_EMAIL: "ci@example.test",
  };
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env: gitEnv, encoding: "utf-8" }).trim();
  const write = (dir: string, file: string, content: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  };

  /**
   * main gets a source change after the branch point, so a diff that took
   * main's own changes for the pull request's would say "applies".
   */
  function mergeCommit(changePr: (dir: string) => void, depth = 2) {
    const origin = tempDir("d36-origin-");
    git(origin, "init", "-q", "-b", "main");
    write(origin, "apps/web/src/a.ts", "export const a = 1;\n");
    write(origin, "docs/x.md", "# x\n");
    write(origin, "CLAUDE.md", "# rules\n");
    git(origin, "add", "-A");
    git(origin, "commit", "-q", "-m", "base");
    git(origin, "checkout", "-q", "-b", "pr");
    changePr(origin);
    git(origin, "add", "-A");
    git(origin, "commit", "-q", "--allow-empty", "-m", "pr");
    const prHead = git(origin, "rev-parse", "HEAD");
    git(origin, "checkout", "-q", "main");
    write(origin, "apps/worker/src/b.ts", "export const b = 2;\n");
    git(origin, "add", "-A");
    git(origin, "commit", "-q", "-m", "main moves on");
    git(origin, "merge", "-q", "--no-ff", "-m", "merge", "pr");
    // A file:// URL, so --depth is honoured as in actions/checkout.
    const clone = path.join(tempDir("d36-clone-"), "repo");
    git(path.dirname(clone), "clone", "-q", `--depth=${depth}`, `file://${origin}`, clone);
    mkdirSync(path.join(clone, "scripts"), { recursive: true });
    copyFileSync(SCRIPT, path.join(clone, "scripts/k6-comparison-scope.mjs"));
    return { clone, prHead };
  }

  function runStep(clone: string, prHead: string, pathPrefix?: string) {
    const summary = path.join(tempDir("d36-summary-"), "summary.md");
    const env: NodeJS.ProcessEnv = { ...gitEnv, PR_HEAD: prHead, GITHUB_STEP_SUMMARY: summary };
    if (pathPrefix) env.PATH = `${pathPrefix}:${env.PATH}`;
    // As GitHub runs it: bash -e, with the step's own set -euo pipefail.
    const result = spawnSync("bash", ["-e", "-c", script], { cwd: clone, env, encoding: "utf-8" });
    // "a+" reads an empty summary when the step never wrote one.
    return { ...result, summary: readFileSync(summary, { encoding: "utf-8", flag: "a+" }) };
  }

  it("is the step as written in ci.yml", () => {
    expect(script).toMatch(/^set -euo pipefail\n/);
    expect(script).toContain('git diff -z --name-only --no-renames HEAD^1 HEAD > "$files"');
    expect(script).toContain('node scripts/k6-comparison-scope.mjs < "$files"');
  });

  it("is not applicable when the pull request only touches docs, Markdown and .claude", () => {
    const { clone, prHead } = mergeCommit((dir) => {
      write(dir, "docs/x.md", "# x, edited\n");
      write(dir, "CLAUDE.md", "# rules, edited\n");
      write(dir, ".claude/settings.json", "{}\n");
      write(dir, "apps/web/src/notes.md", "notes\n");
    });
    const result = runStep(clone, prHead);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(NOT_APPLICABLE);
    expect(result.stdout).toContain("(4 files)");
    expect(result.summary).toContain(NOT_APPLICABLE);
  });

  it("applies when the pull request changes source", () => {
    const odd = "apps/web/src/ñ\n::warning::x.ts";
    const { clone, prHead } = mergeCommit((dir) => {
      write(dir, "docs/x.md", "# x, edited\n");
      write(dir, "apps/web/src/a.ts", "export const a = 3;\n");
      write(dir, odd, "export {};\n");
    });
    const result = runStep(clone, prHead);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(APPLIES);
    expect(result.summary).toContain(APPLIES);
    expect(result.stdout).toContain("changes 2 of 3 files");
    expect(result.stdout).toContain('- "apps/web/src/a.ts"');
    // A real git path with a newline and "::" arrives whole and quoted.
    expect(result.stdout).toContain(`- ${JSON.stringify(odd)}`);
    expect(result.stdout.split("\n").some((line) => line.startsWith("::"))).toBe(false);
    // main's own change after the branch point is not the pull request's.
    expect(result.stdout).not.toContain("b.ts");
  });

  it("fails when git diff fails, instead of reading an empty diff", () => {
    const { clone, prHead } = mergeCommit((dir) => write(dir, "docs/x.md", "# x, edited\n"));
    const realGit = execFileSync("bash", ["-c", "command -v git"], { encoding: "utf-8" }).trim();
    const shims = tempDir("d36-git-shim-");
    writeFileSync(path.join(shims, "git"), `#!/usr/bin/env bash\n[ "$1" = diff ] && exit 128\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
    const result = runStep(clone, prHead, shims);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("D36 comparison");
    expect(result.summary).toBe("");
  });

  it("applies when source is renamed into docs/ (the deleted path counts)", () => {
    const { clone, prHead } = mergeCommit((dir) => git(dir, "mv", "apps/web/src/a.ts", "docs/a.ts"));
    const result = runStep(clone, prHead);
    expect(result.stdout).toContain(APPLIES);
    expect(result.stdout).toContain('- "apps/web/src/a.ts"');
  });

  it("applies when source is deleted", () => {
    const { clone, prHead } = mergeCommit((dir) => rmSync(path.join(dir, "apps/web/src/a.ts")));
    const result = runStep(clone, prHead);
    expect(result.stdout).toContain(APPLIES);
    expect(result.stdout).toContain('- "apps/web/src/a.ts"');
  });

  it("is not applicable when the merge equals main", () => {
    const { clone, prHead } = mergeCommit(() => {});
    const result = runStep(clone, prHead);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(NOT_APPLICABLE);
    expect(result.stdout).toContain("(0 files)");
  });

  it("fails without the merge commit's parents (depth 1)", () => {
    const { clone, prHead } = mergeCommit((dir) => write(dir, "docs/x.md", "# x, edited\n"), 1);
    const result = runStep(clone, prHead);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("::error::HEAD is not the merge commit of this pull request");
    expect(result.stdout).not.toContain("D36 comparison");
  });

  it("fails when HEAD^2 is not the pull request's head, or the head is unknown", () => {
    const { clone } = mergeCommit((dir) => write(dir, "docs/x.md", "# x, edited\n"));
    for (const head of ["0".repeat(40), ""]) {
      const result = runStep(clone, head);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("::error::HEAD is not the merge commit of this pull request");
    }
  });
});

describe("where the step sits in the docker job (D36)", () => {
  const steps = dockerSteps();
  const index = (needle: string) => steps.findIndex((s) => s.includes(needle));

  it("checks out the merge commit with both parents", () => {
    expect(steps[0]).toMatch(/^uses: actions\/checkout@v\d+\n\s+with:\n\s+fetch-depth: 2\b/);
  });

  it("runs only on pull requests, before the images are built", () => {
    expect(stepNamed(STEP)).toContain("if: github.event_name == 'pull_request'");
    expect(index(`name: ${STEP}`)).toBeGreaterThan(-1);
    expect(index(`name: ${STEP}`)).toBeLessThan(index("run: npm run local:up"));
  });

  it("leaves the k6 run itself unconditional", () => {
    const k6 = stepNamed("k6 load test, short run (D36)");
    expect(k6).not.toMatch(/^\s+if:/m);
    expect(k6).not.toContain("continue-on-error");
  });
});

describe("what the exemption assumes (D36)", () => {
  it("keeps docs/ out of the image build context", () => {
    const ignored = readFileSync(path.join(REPO, ".dockerignore"), "utf-8").split("\n").map((line) => line.trim());
    expect(ignored.some((line) => /^\/?docs\/?$/.test(line))).toBe(true);
  });

  it.each(["apps/web/Dockerfile", "apps/worker/Dockerfile"])("%s: the final stage copies only build output from earlier stages", (file) => {
    const dockerfile = readFileSync(path.join(REPO, file), "utf-8");
    const finalStage = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
    expect(finalStage).toMatch(/^\nFROM \S+ AS runner\n/);
    const copies = finalStage.split("\n").filter((line) => /^COPY\b/.test(line));
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) {
      expect(copy).toMatch(/^COPY --from=\w+ /);
      expect(copy).not.toMatch(/docs|\.claude|\.md\b/);
    }
  });

  it("no application source reads a Markdown file", () => {
    const tracked = execFileSync("git", ["ls-files", "apps/web/src", "apps/worker/src", "packages/*/src", "apps/web/next.config.ts"], {
      cwd: REPO,
      encoding: "utf-8",
    })
      .split("\n")
      .filter((file) => /\.(ts|tsx|js|mjs|cjs|json|css)$/.test(file));
    // The scan really covers the application (not an empty file list).
    expect(tracked).toEqual(expect.arrayContaining(["apps/web/next.config.ts", "apps/web/src/app/layout.tsx", "apps/worker/src/index.ts"]));
    const readers = tracked.filter((file) => /\.md\b/.test(readFileSync(path.join(REPO, file), "utf-8")));
    expect(readers).toEqual([]);
  });
});
