import { afterAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  CEILING,
  GateError,
  IMAGES,
  LIMIT,
  LOAD_PARAMS,
  MIN_STEADY_PAGES,
  ORDER,
  PASSES,
  SENTINELS,
  VERDICTS,
  abLine,
  brokenRunVerdict,
  decide,
  filesInImages,
  loadParams,
  parseListing,
  passLine,
  ratio,
  runAttempt,
  treeRecord,
  validatePass,
  verdict,
} from "../../../../scripts/d56-ab.mjs";
import { ISOLATION_CHECK, readCsvRows } from "../../../../scripts/d36-diag.mjs";

/**
 * D56: the k6 gate compares the PR with main on the same runner, in the order
 * main, PR, PR, main. These tests take each closing condition of D56 in turn
 * and show it holds: what is checked, and that the check fails when it should.
 */

const REPO = path.resolve(__dirname, "../../../..");
const CI = readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf-8");
const AB_SH = readFileSync(path.join(REPO, "scripts/d56-ab.sh"), "utf-8");
const LOCAL_UP = readFileSync(path.join(REPO, "scripts/local-up.sh"), "utf-8");
const OVERRIDE = readFileSync(path.join(REPO, "scripts/d56-main-images.compose.yml"), "utf-8");
const D36_STEP = "k6 load test, short run (D36)";
const SECOND_STEP = "Second k6 pass, informational, not part of D36 (D54)";
const TREE_STEP = "Main's tree at HEAD^1 (D56)";
const MAIN1_STEP = "Main's first k6 pass (D56 main-1)";
const PR_STEP = "The PR's k6 passes for D56 (pr-1, pr-2)";
const MAIN2_STEP = "Main's second k6 pass (D56 main-2)";
const RATIO_STEP = "D56 A/B ratio of the four k6 passes";
const ARTIFACT_STEP = "D56 artifact";
const SCOPE_STEP = "Does the diff change the images? (D36)";

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

// ci.yml, split as the other docker-job tests split it.
function dockerSteps(): string[] {
  const start = CI.indexOf("\n  docker:\n");
  if (start === -1) throw new Error("no docker job in ci.yml");
  const rest = CI.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  const job = next === -1 ? rest : rest.slice(0, next + 1);
  return job.split("\n      - ").slice(1);
}
const dockerJobHeader = () => {
  const start = CI.indexOf("\n  docker:\n");
  return CI.slice(start, CI.indexOf("\n    steps:\n", start) + 1);
};
const stepName = (step: string) => /name: (.+)/.exec(step)?.[1] ?? "";
function stepNamed(name: string): string {
  const step = dockerSteps().find((s) => stepName(s) === name);
  if (!step) throw new Error(`no step "${name}" in the docker job`);
  return step;
}
/** The step's own lines, without the comments that precede the next step. */
const ownLines = (step: string) => step.split("\n").filter((line) => !/^\s+#/.test(line));
function envBlock(step: string): Record<string, string> {
  const lines = step.split("\n");
  const start = lines.findIndex((line) => line.trim() === "env:");
  if (start === -1) throw new Error("the step has no env block");
  const env: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const match = /^ {10}([A-Z_]+): "?([^"]*)"?$/.exec(line);
    if (!match) break;
    env[match[1]] = match[2];
  }
  return env;
}
const loadSettings = (step: string) => Object.fromEntries(LOAD_PARAMS.map((key) => [key, envBlock(step)[key]]));

// Fixtures: four passes as k6 v1.8.2 writes them.
const CSV_HEADER =
  "metric_name,timestamp,metric_value,check,error,error_code,expected_response,group,method,name,proto,scenario,service,status,subproto,tls_version,url,extra_tags,metadata";
const PARAMS = { LOAD_BIG_USERS: "60", LOAD_SMALL_USERS: "5", LOAD_VUS: "60", SMALL_VUS: "5", RAMP: "20s", HOLD: "40s", THINK_MIN: "2", THINK_MAX: "6" };
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const BASE_REV = "aaaaaaaaaaaa";
const HEAD_REV = "bbbbbbbbbbbb";
const MAIN_IMAGE = { web: `sha256:${"1".repeat(64)}`, worker: `sha256:${"2".repeat(64)}` };
const PR_IMAGE = { web: `sha256:${"3".repeat(64)}`, worker: `sha256:${"4".repeat(64)}` };
const START: Record<string, number> = { "main-1": 1_800_000_000_000, "pr-1": 1_800_000_600_000, "pr-2": 1_800_000_700_000, "main-2": 1_800_001_000_000 };

interface PassOptions {
  p95?: number;
  samples?: number;
  isolationFails?: number;
  isolationFlag?: unknown;
  failedFlag?: unknown;
  vus?: number;
  start?: number;
}
function csvOf({ p95 = 60, samples = 600, start = 1_800_000_000_000 }: PassOptions) {
  const rows = [`http_reqs,${start},1.000000,,,,true,,POST,http://127.0.0.1:54321/auth/v1/token,HTTP/1.1,one_tenant,,200,,,http://127.0.0.1:54321/auth/v1/token,kind=auth&phase=ramp,`];
  for (let i = 0; i < samples; i += 1) {
    rows.push(`http_req_duration,${start + 30_000 + i},${p95.toFixed(6)},,,,true,,GET,http://127.0.0.1:3000/profile,HTTP/1.1,one_tenant,,200,,,http://127.0.0.1:3000/profile,page=/profile&kind=page&phase=steady,`);
  }
  return gzipSync(`${CSV_HEADER}\n${rows.join("\n")}\n`);
}
function summaryOf({ p95 = 60, samples = 600, isolationFails = 0, isolationFlag, failedFlag = false, vus = 75, start = 1_800_000_000_000 }: PassOptions) {
  const flag = (value: unknown) => value;
  return {
    metrics: {
      // Two real passes never write the same summary; their iteration counts differ.
      iterations: { count: start, rate: 1 },
      [CEILING]: { avg: p95, med: p95, "p(90)": p95, "p(95)": p95, "p(99)": p95, max: p95, thresholds: { "p(95)<500": p95 >= 500 } },
      "http_req_duration{kind:page,phase:ramp}": { max: p95, thresholds: { "max>=0": false } },
      "http_req_failed{kind:page}": { passes: 0, fails: samples, value: 0, thresholds: { "rate<0.01": flag(failedFlag) } },
      checks: { passes: samples * 2, fails: 0, value: 1, thresholds: { "rate>0.99": false } },
      [`checks{check:${ISOLATION_CHECK}}`]: { passes: samples - isolationFails, fails: isolationFails, value: 1, thresholds: { "rate==1": isolationFlag ?? isolationFails > 0 } },
      "http_reqs{kind:auth,phase:ramp}": { count: 71, rate: 1, thresholds: { "count>=0": false } },
      vus_max: { value: vus, min: vus, max: vus },
    },
    root_group: { checks: { "signed in": { passes: 75, fails: 0 }, [ISOLATION_CHECK]: { passes: samples - isolationFails, fails: isolationFails } } },
  };
}
function recordOf(name: string, overrides: Record<string, unknown> = {}) {
  const spec = PASSES[name as keyof typeof PASSES];
  const image = spec.role === "main" ? MAIN_IMAGE : PR_IMAGE;
  return {
    pass: name,
    role: spec.role,
    summary: spec.summary,
    csv: spec.csv,
    k6_exit: "0",
    web_image: image.web,
    worker_image: image.worker,
    expected_web: image.web,
    expected_worker: image.worker,
    revision: spec.role === "main" ? BASE_REV : HEAD_REV,
    cpu: "AMD EPYC 9V74 80-Core Processor",
    harness: "0123456789ab",
    params: { ...PARAMS },
    run_attempt: "1",
    ...overrides,
  };
}
const nul = (files: string[]) => Buffer.from(files.map((f) => `${f}\0`).join(""));
function treeOf(files: string[], markdown: Record<string, { head: string | null; base: string | null }> = {}, harnessChanged = false) {
  const diff = nul(files);
  return {
    diff,
    tree: {
      worktree: "/runner/_temp/d56/ScaliaHR",
      base_sha: BASE_SHA,
      head_sha: HEAD_SHA,
      base_revision: BASE_REV,
      head_revision: HEAD_REV,
      diff_sha256: execFileSync("sha256sum", { input: diff }).toString().slice(0, 64),
      diff_files: files.length,
      harness_changed: harnessChanged,
      markdown,
    },
  };
}
const listing = (files: string[], md: Record<string, string> = {}) => ({ files, md });
const IMAGE_LISTINGS = {
  web: listing([SENTINELS.web, "/app/apps/web/package.json"]),
  worker: listing([SENTINELS.worker, "/app/apps/worker/dist/index.js"]),
};

interface World {
  files: Map<string, Buffer>;
}
/** The files the earlier steps leave in load/.out, for all four passes unless told otherwise. */
function world({
  passes = ORDER as readonly string[],
  diffFiles = ["apps/web/src/app/page.tsx"],
  markdown = {},
  harnessChanged = false,
  options = {} as Record<string, PassOptions>,
  records = {} as Record<string, Record<string, unknown>>,
  images = { pr: IMAGE_LISTINGS, main: IMAGE_LISTINGS } as Record<string, unknown> | null,
} = {}): World {
  const files = new Map<string, Buffer>();
  const { diff, tree } = treeOf(diffFiles, markdown, harnessChanged);
  files.set("d56-tree.json", Buffer.from(JSON.stringify(tree)));
  files.set("d56-diff.bin", diff);
  for (const name of passes) {
    const spec = PASSES[name as keyof typeof PASSES];
    const opts = { start: START[name], ...options[name] };
    files.set(`d56-pass-${name}.json`, Buffer.from(JSON.stringify(recordOf(name, records[name]))));
    files.set(spec.summary, Buffer.from(JSON.stringify(summaryOf(opts))));
    files.set(spec.csv, csvOf(opts));
  }
  if (images) for (const [role, value] of Object.entries(images)) files.set(`d56-images-${role}.json`, Buffer.from(JSON.stringify(value)));
  return { files };
}
const reader = (w: World) => (file: string) => w.files.get(file) ?? null;
const decideIn = (w: World, { event = "pull_request", scopeApplies = "true", attempt = "1" } = {}) =>
  decide({ event, scopeApplies, attemptValue: attempt, read: reader(w) });
/** The GateError a call throws, so a test can check its verdict and message. */
function gateError(fn: () => unknown): GateError {
  try {
    fn();
  } catch (error) {
    if (error instanceof GateError) return error;
    throw error;
  }
  throw new Error("expected a GateError, nothing was thrown");
}

const validTree = treeOf(["apps/web/src/app/page.tsx"]).tree;
const validate = (name: string, opts: PassOptions = {}, record: Record<string, unknown> = {}, tree = validTree) =>
  validatePass(name, recordOf(name, record), summaryOf(opts), readCsvRows(csvOf(opts)), tree);

describe("1. the ratio step runs unconditionally and fails the job when it cannot compute r (D56)", () => {
  it("has no if: and no continue-on-error, and runs the ratio script with the scope step's verdict", () => {
    const step = stepNamed(RATIO_STEP);
    expect(ownLines(step).join("\n")).not.toMatch(/^\s+(if|continue-on-error):/m);
    expect(step).toContain("run: node scripts/d56-ab.mjs ratio");
    expect(envBlock(step)).toEqual({ SCOPE_APPLIES: "${{ steps.scope.outputs.applies }}" });
  });

  it("comes after main's second pass and before the job's cleanup steps", () => {
    const names = dockerSteps().map(stepName);
    expect(names.indexOf(RATIO_STEP)).toBe(names.indexOf(MAIN2_STEP) + 1);
    expect(names.indexOf(ARTIFACT_STEP)).toBe(names.indexOf(RATIO_STEP) + 1);
    expect(names.indexOf(RATIO_STEP)).toBeLessThan(names.indexOf("Container logs (on failure)"));
  });

  it.each([TREE_STEP, MAIN1_STEP, PR_STEP, MAIN2_STEP])("%s never continues on error", (name) => {
    expect(ownLines(stepNamed(name)).join("\n")).not.toMatch(/^\s+continue-on-error:/m);
  });

  it("fails, with an annotation, when the earlier steps left nothing to compare", () => {
    const work = tempDir("d56-empty-");
    mkdirSync(path.join(work, "load/.out"), { recursive: true });
    const result = spawnSync("node", [path.join(REPO, "scripts/d56-ab.mjs"), "ratio"], {
      cwd: work,
      encoding: "utf-8",
      env: { ...process.env, GITHUB_EVENT_NAME: "pull_request", SCOPE_APPLIES: "true", GITHUB_RUN_ATTEMPT: "1" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^::error::D56: d56-tree\.json is missing.*\("sin referencia"\)$/m);
  });

  it("fails on a result it cannot compare: an r that is not a number never passes", () => {
    expect(verdict({ event: "pull_request", applies: true, r: Number.NaN, attempt: 1 }).pass).toBe(false);
    expect(verdict({ event: "push", applies: true, r: Number.NaN, attempt: 1 }).pass).toBe(false);
  });
});

describe("2. every pass is validated before it counts (D56)", () => {
  it.each([
    ["0", true],
    ["99", true],
    ["1", false],
    ["107", false],
    ["", false],
    ["x", false],
  ])("main's k6 exit %j is accepted: %s", (exit, ok) => {
    if (ok) expect(validate("main-1", {}, { k6_exit: exit }).p95).toBe(60);
    else expect(gateError(() => validate("main-1", {}, { k6_exit: exit })).verdict).toBe(VERDICTS.noReference);
  });

  it("takes pr-1 only when the D36 step passed (exit 0), and labels a broken PR pass as the PR's", () => {
    expect(gateError(() => validate("pr-1", {}, { k6_exit: "99" })).verdict).toBe(VERDICTS.prInvalid);
    expect(gateError(() => validate("pr-2", {}, { k6_exit: "1" })).verdict).toBe(VERDICTS.prInvalid);
    expect(validate("pr-2", {}, { k6_exit: "99" }).samples).toBe(600);
  });

  it(`refuses fewer than ${MIN_STEADY_PAGES} steady-state page samples`, () => {
    expect(validate("main-1", { samples: MIN_STEADY_PAGES }).samples).toBe(MIN_STEADY_PAGES);
    expect(gateError(() => validate("main-1", { samples: MIN_STEADY_PAGES - 1 })).message).toContain("fewer than 500");
  });

  it("refuses a CSV whose steady-state p95 is not its summary's", () => {
    const record = recordOf("main-1");
    expect(gateError(() => validatePass("main-1", record, summaryOf({ p95: 60 }), readCsvRows(csvOf({ p95: 61 })), validTree)).message).toContain("is not its summary's");
  });

  it("refuses a crossed correctness threshold, and takes the 500 ms ceiling as a measurement", () => {
    expect(gateError(() => validate("main-1", { failedFlag: true })).message).toContain("http_req_failed{kind:page} rate<0.01 was crossed");
    expect(gateError(() => validate("main-1", { failedFlag: null })).message).toContain("has no result");
    expect(validate("main-1", { p95: 650 }).p95).toBe(650);
  });

  it("refuses an isolation threshold that contradicts the isolation count: a summary in an unknown format", () => {
    expect(gateError(() => validate("main-1", { isolationFlag: true })).message).toContain("unknown format");
  });

  it("refuses a run with other users than the settings say", () => {
    expect(gateError(() => validate("main-1", { vus: 74 })).message).toContain("vus_max is 74");
  });

  it("refuses a p95 that is not a positive number", () => {
    const record = recordOf("main-1");
    const summary = summaryOf({});
    (summary.metrics[CEILING] as Record<string, unknown>)["p(95)"] = 0;
    expect(gateError(() => validatePass("main-1", record, summary, readCsvRows(csvOf({})), validTree)).message).toContain("above 0");
  });
});

describe("3. a missing tenant-isolation count fails, in every pass (D56)", () => {
  it.each(ORDER)("%s without an isolation count fails", (name) => {
    const record = recordOf(name);
    const summary = summaryOf({}) as { root_group: { checks: Record<string, unknown> } };
    delete summary.root_group.checks[ISOLATION_CHECK];
    expect(gateError(() => validatePass(name, record, summary, readCsvRows(csvOf({})), validTree)).message).toContain("no tenant-isolation count");
  });

  it('fails main as "main falla aislamiento", with no ratio, and the PR as its own leak', () => {
    const w = world({ options: { "main-2": { isolationFails: 1 } } });
    const error = gateError(() => decideIn(w));
    expect(error.verdict).toBe(VERDICTS.mainIsolation);
    expect(error.message).toBe("main-2: 1 page(s) showed another tenant's employees");
    expect(gateError(() => decideIn(world({ options: { "pr-2": { isolationFails: 2 } } }))).verdict).toBe(VERDICTS.prIsolation);
  });
});

describe("4. the image each pass measured (D56)", () => {
  it("accepts main's :base images and the PR's :local images, different and each as expected", () => {
    const decision = decideIn(world());
    expect(decision.pass).toBe(true);
    const passes = decision.passes as Record<string, { record: { web_image: string } }>;
    expect(passes["main-1"].record.web_image).toBe(MAIN_IMAGE.web);
    expect(passes["pr-1"].record.web_image).toBe(PR_IMAGE.web);
  });

  it.each([
    ["main's and the PR's are the same image", { "main-1": { web_image: PR_IMAGE.web, expected_web: PR_IMAGE.web }, "main-2": { web_image: PR_IMAGE.web, expected_web: PR_IMAGE.web } }, "the same image"],
    ["main-1 and main-2 differ", { "main-2": { web_image: `sha256:${"5".repeat(64)}`, expected_web: `sha256:${"5".repeat(64)}` } }, "main-1 and main-2 measured different images"],
    ["pr-1 and pr-2 differ", { "pr-2": { web_image: `sha256:${"6".repeat(64)}`, expected_web: `sha256:${"6".repeat(64)}` } }, "pr-1 and pr-2 measured different images"],
    ["the running web image is not the tag's", { "pr-1": { web_image: MAIN_IMAGE.web } }, "an image other than scaliahr-web:local"],
    ["the running worker is not the tag's", { "main-1": { worker_image: PR_IMAGE.worker } }, "an image other than scaliahr-web:base"],
    ["main's revision is not HEAD^1's", { "main-1": { revision: HEAD_REV } }, `ran revision ${HEAD_REV}, not ${BASE_REV}`],
    ["the PR's revision is not HEAD's", { "pr-2": { revision: BASE_REV } }, `ran revision ${BASE_REV}, not ${HEAD_REV}`],
  ])("fails when %s", (_case, records, message) => {
    const error = gateError(() => decideIn(world({ records })));
    expect(error.verdict).toBe(VERDICTS.mismatch);
    expect(error.message).toContain(message);
  });

  it("gives main's images their own tags, never :local or :previous", () => {
    expect(IMAGES).toEqual({ main: { web: "scaliahr-web:base", worker: "scaliahr-worker:base" }, pr: { web: "scaliahr-web:local", worker: "scaliahr-worker:local" } });
    expect(OVERRIDE).toMatch(/web:\n\s+image: scaliahr-web:base\n/);
    expect(OVERRIDE).toMatch(/worker:\n\s+image: scaliahr-worker:base\n/);
    // Its code, not the comments that explain why: it never tags, and never names :local or :previous.
    const code = AB_SH.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
    expect(code).not.toMatch(/docker tag|:local\b|:previous\b/);
    expect(AB_SH).toContain('-f "$REPO_ROOT/scripts/d56-main-images.compose.yml"');
  });
});

describe("5. main's worktree is exactly HEAD^1 (D56)", () => {
  it("refuses a worktree at another commit, the same commit as HEAD, or a dirty describe", () => {
    const base = { worktree: "/w", worktreeHead: BASE_SHA, baseSha: BASE_SHA, headSha: HEAD_SHA, baseRevision: BASE_REV, headRevision: HEAD_REV, diff: nul([]), blob: () => null };
    expect(treeRecord(base).base_sha).toBe(BASE_SHA);
    expect(gateError(() => treeRecord({ ...base, worktreeHead: HEAD_SHA })).message).toContain(`not at HEAD^1 ${BASE_SHA}`);
    expect(gateError(() => treeRecord({ ...base, headSha: BASE_SHA })).message).toContain("the same commit");
    expect(gateError(() => treeRecord({ ...base, baseRevision: `${BASE_REV}-dirty` })).message).toContain("not a clean describe");
    expect(gateError(() => treeRecord({ ...base, baseSha: "HEAD^1" })).message).toContain("not a commit SHA");
  });

  it("records the diff's hash and count, so a missing or other diff never reads as an empty one", () => {
    const w = world();
    w.files.set("d56-diff.bin", nul([]));
    expect(gateError(() => decideIn(w)).message).toContain("is not the diff the tree step recorded");
    w.files.delete("d56-diff.bin");
    expect(gateError(() => decideIn(w)).message).toContain("d56-diff.bin is missing");
  });

  it("is the first D56 step, unconditional, with the pull request's head for the merge-commit check", () => {
    const step = stepNamed(TREE_STEP);
    expect(step).toContain("run: bash scripts/d56-ab.sh tree");
    expect(ownLines(step).join("\n")).not.toMatch(/^\s+if:/m);
    expect(envBlock(step)).toEqual({ PR_HEAD: "${{ github.event.pull_request.head.sha }}" });
    const names = dockerSteps().map(stepName);
    expect(names.indexOf(TREE_STEP)).toBe(names.indexOf(MAIN1_STEP) - 1);
  });
});

describe("6. a broken main pass fails closed; one re-run, enforced in the script (D56)", () => {
  it('names a main pass that did not run "sin referencia", or the PR\'s harness when the PR changed it', () => {
    expect(brokenRunVerdict("main", false)).toBe(VERDICTS.noReference);
    expect(brokenRunVerdict("main", true)).toBe("arnés del PR incompatible con main");
    expect(brokenRunVerdict("pr", true)).toBe(VERDICTS.prInvalid);
    const changed = treeOf(["load/pages.js"], {}, true).tree;
    expect(gateError(() => validate("main-1", {}, { k6_exit: "107" }, changed)).verdict).toBe(VERDICTS.harness);
  });

  it("fails without main's passes when the scope applies, never passing open", () => {
    const error = gateError(() => decideIn(world({ passes: ["pr-1", "pr-2"] })));
    expect(error.verdict).toBe(VERDICTS.noReference);
    expect(error.message).toBe("main's passes are missing (main-1, main-2)");
    expect(gateError(() => decideIn(world({ passes: ["main-1", "pr-1", "pr-2"] }))).message).toContain("(main-2)");
  });

  it.each([
    ["pull_request", 1, 1.1, true, undefined],
    ["pull_request", 1, LIMIT, true, undefined],
    ["pull_request", 1, 1.21, false, VERDICTS.overFirst],
    ["pull_request", 2, 1.19, true, undefined],
    ["pull_request", 2, 1.21, false, VERDICTS.overSecond],
    ["pull_request", 3, 1.0, false, VERDICTS.cap],
    ["push", 1, 1.1, true, undefined],
    ["push", 1, 1.21, false, VERDICTS.mergedRegression],
    ["push", 2, 1.21, false, VERDICTS.mergedRegression],
  ])("%s, attempt %i, r %f: passes %s", (event, attempt, r, pass, label) => {
    const result = verdict({ event, applies: true, r, attempt });
    expect(result.pass).toBe(pass);
    expect(result.label).toBe(label);
  });

  it("never blocks a docs-only change, whatever the attempt or r", () => {
    expect(verdict({ event: "pull_request", applies: false, r: 2, attempt: 3 }).pass).toBe(true);
    expect(verdict({ event: "push", applies: false, r: 2, attempt: 1 }).pass).toBe(true);
  });

  it.each(["", "0", "2a", undefined])("refuses the run attempt %j instead of skipping the cap", (value) => {
    expect(() => runAttempt(value)).toThrow("is not an attempt number");
  });

  it("computes r as the ratio of the geometric means", () => {
    expect(ratio([50, 72], [60, 60])).toBeCloseTo(Math.exp((2 * Math.log(60) - Math.log(50) - Math.log(72)) / 2), 12);
    expect(ratio([100, 100], [120, 120])).toBeCloseTo(1.2, 12);
  });

  it("blocks on the first attempt above the limit and tells how to confirm it, then blocks on the re-run", () => {
    const slow = { "pr-1": { p95: 80 }, "pr-2": { p95: 80 } };
    const first = decideIn(world({ options: slow }));
    expect(first.pass).toBe(false);
    expect(first.r).toBeCloseTo(80 / 60, 12);
    expect(first.verdict).toContain("one re-run of the docker job is allowed");
    const records = Object.fromEntries(ORDER.map((name) => [name, { run_attempt: "2" }]));
    expect(decideIn(world({ options: slow, records }), { attempt: "2" }).label).toBe(VERDICTS.overSecond);
  });
});

describe("7. each pass reads its own files (D56)", () => {
  it("maps every pass to its own summary, CSV and output", () => {
    expect(ORDER).toEqual(["main-1", "pr-1", "pr-2", "main-2"]);
    const files = Object.values(PASSES).flatMap((spec) => [spec.summary, spec.csv]);
    expect(new Set(files).size).toBe(files.length);
    expect(PASSES["pr-1"]).toMatchObject({ summary: "summary.json", csv: "requests-first.csv.gz" });
    expect(PASSES["pr-2"]).toMatchObject({ summary: "summary-second.json", csv: "requests-second.csv.gz", output: "second-pass.txt" });
  });

  it("refuses a record that names another pass's summary", () => {
    expect(gateError(() => validate("pr-2", {}, { summary: "summary.json" })).message).toContain("is not its own");
  });

  it("refuses two passes with the same summary, and passes out of the order main, PR, PR, main", () => {
    const w = world();
    w.files.set("summary-main-2.json", w.files.get("summary-main-1.json")!);
    w.files.set("requests-main-2.csv.gz", csvOf({ start: START["main-2"] }));
    expect(gateError(() => decideIn(w)).message).toBe("two passes have the same summary");
    const late = world({ options: { "main-1": { start: START["pr-2"] + 1 } } });
    expect(gateError(() => decideIn(late)).message).toContain("pr-1 did not start after main-1");
  });

  it("runs main's passes through the PR's harness, each with its own summary and CSV, its k6 output to a file", () => {
    expect(AB_SH).toContain(
      'LOAD_SUMMARY="summary-${pass}.json" npm run load:test -- --out "csv=fileName=/out/requests-${pass}.csv.gz,timeFormat=unix_milli" \\\n    > "$OUT/k6-${pass}.txt" 2>&1 || code=$?',
    );
    // In ci.yml only the D36 step and the D54 second pass call load:test; main's passes go through d56-ab.sh.
    const callers = dockerSteps().filter((step) => step.includes("npm run load:test")).map(stepName);
    expect(callers).toEqual([D36_STEP, SECOND_STEP]);
  });
});

describe("8. the same load settings in every pass, printed (D56)", () => {
  it.each([MAIN1_STEP, PR_STEP, MAIN2_STEP, SECOND_STEP])("%s runs with the D36 step's eight load settings", (name) => {
    expect(loadSettings(stepNamed(name))).toEqual(loadSettings(stepNamed(D36_STEP)));
    expect(loadSettings(stepNamed(D36_STEP))).toEqual(PARAMS);
  });

  it("refuses a record without one of them, and a pass that ran with another", () => {
    expect(() => loadParams({ ...PARAMS, HOLD: "" })).toThrow("HOLD is not set");
    const error = gateError(() => decideIn(world({ records: { "main-2": { params: { ...PARAMS, HOLD: "41s" } } } })));
    expect(error.message).toBe("main-2 ran with HOLD=41s, main-1 with 40s");
    expect(gateError(() => decideIn(world({ records: { "pr-2": { harness: "ffffffffffff" } } }))).message).toContain("another harness");
  });

  it("prints all eight, the harness, the image, the CPU and the stack's state on each pass's line", () => {
    const line = passLine("main-1", recordOf("main-1"), { p95: 66.02, samples: 942, firstRequest: 0 });
    expect(line).toBe(
      `D56-ab: pass pass=main-1 role=main stack=fresh p95_steady_ms=66.02 samples=942 k6_exit=0 web_image=${MAIN_IMAGE.web} revision=${BASE_REV} cpu="AMD EPYC 9V74 80-Core Processor" harness=0123456789ab params="LOAD_BIG_USERS=60,LOAD_SMALL_USERS=5,LOAD_VUS=60,SMALL_VUS=5,RAMP=20s,HOLD=40s,THINK_MIN=2,THINK_MAX=6" attempt=1`,
    );
    expect(() => abLine("pass", { line: "{ kind:page,phase:steady }" })).toThrow("never carries");
  });
});

describe("9. the docker job has a time limit (D56)", () => {
  it("sets timeout-minutes, so a hung job fails instead of running for 6 h", () => {
    expect(dockerJobHeader()).toMatch(/\n {4}timeout-minutes: (\d+)\n/);
    const minutes = Number(/\n {4}timeout-minutes: (\d+)\n/.exec(dockerJobHeader())?.[1]);
    expect(minutes).toBeGreaterThanOrEqual(30);
    expect(minutes).toBeLessThanOrEqual(60);
  });
});

describe("10. a docs-only diff does not exempt a file that is in an image (D56)", () => {
  const md = "a".repeat(64);
  it("finds a changed file by its path under /app, and Markdown by its content, before or after the change", () => {
    const tree = { files: ["apps/web/src/notes.md", "docs/a.md"], markdown: { "apps/web/src/notes.md": { head: null, base: md }, "docs/a.md": { head: "b".repeat(64), base: null } } };
    expect(filesInImages(tree, [listing(["/app/apps/web/src/notes.md"])])).toEqual(["apps/web/src/notes.md"]);
    expect(filesInImages(tree, [listing([], { "/app/apps/web/README-copy.md": "b".repeat(64) })])).toEqual(["docs/a.md"]);
    expect(filesInImages(tree, [listing([], { "/app/x.md": md })])).toEqual(["apps/web/src/notes.md"]);
    expect(filesInImages(tree, [listing(["/app/apps/web/server.js"])])).toEqual([]);
  });

  it("fails a docs-only pull request whose changed Markdown is in the PR's image", () => {
    const w = world({
      passes: ["pr-1", "pr-2"],
      diffFiles: ["docs/a.md"],
      markdown: { "docs/a.md": { head: md, base: null } },
      images: { pr: { web: listing([SENTINELS.web], { "/app/apps/web/docs-a.md": md }), worker: IMAGE_LISTINGS.worker } },
    });
    const error = gateError(() => decideIn(w, { scopeApplies: "false" }));
    expect(error.verdict).toBe(VERDICTS.docsOnlyWrong);
    expect(error.message).toContain("docs/a.md is in an image");
  });

  it("passes a docs-only pull request without main's passes when no changed file is in an image", () => {
    const decision = decideIn(world({ passes: ["pr-1", "pr-2"], diffFiles: ["docs/a.md"], images: { pr: IMAGE_LISTINGS } }), { scopeApplies: "false" });
    expect(decision).toMatchObject({ pass: true, applies: false });
    expect(Number.isNaN(decision.r)).toBe(true);
  });

  it("fails a docs-only diff when an image was not listed, or its listing is not a full one", () => {
    const w = world({ passes: ["pr-1", "pr-2"], diffFiles: ["docs/a.md"], images: null });
    expect(gateError(() => decideIn(w, { scopeApplies: "false" })).message).toContain("the pr images were not listed");
    expect(() => parseListing("/app/x\n--d56-md--\n", SENTINELS.web)).toThrow("lacks /app/apps/web/server.js");
    expect(() => parseListing(`${SENTINELS.web}\n`, SENTINELS.web)).toThrow("no Markdown section");
    expect(parseListing(`${SENTINELS.web}\n--d56-md--\n${md}  /app/a.md\n`, SENTINELS.web)).toEqual({ files: [SENTINELS.web], md: { "/app/a.md": md } });
  });

  it("on a push, compares a docs-only diff with main's images too, and the change counts", () => {
    const w = world({
      diffFiles: ["docs/a.md"],
      markdown: { "docs/a.md": { head: null, base: md } },
      images: { pr: IMAGE_LISTINGS, main: { web: listing([SENTINELS.web], { "/app/apps/web/a.md": md }), worker: IMAGE_LISTINGS.worker } },
    });
    expect(decideIn(w, { event: "push", scopeApplies: "" }).applies).toBe(true);
  });
});

describe("pull requests and pushes (D56)", () => {
  it("on a pull request needs the scope step's verdict, the same one this diff gives", () => {
    expect(gateError(() => decideIn(world(), { scopeApplies: "" })).message).toContain("left no verdict");
    expect(gateError(() => decideIn(world(), { scopeApplies: "false" })).message).toContain("not the one for this diff");
  });

  it("on a push compares with HEAD^1 and fails once above the limit, as a regression already merged", () => {
    const slow = { "pr-1": { p95: 80 }, "pr-2": { p95: 80 } };
    const decision = decideIn(world({ options: slow }), { event: "push", scopeApplies: "" });
    expect(decision).toMatchObject({ pass: false, label: VERDICTS.mergedRegression });
    expect(decideIn(world(), { event: "push", scopeApplies: "" }).pass).toBe(true);
    expect(gateError(() => decideIn(world(), { event: "push", scopeApplies: "true" })).message).toContain("a push has no scope step");
    expect(gateError(() => decideIn(world(), { event: "workflow_dispatch" })).message).toContain('unknown event "workflow_dispatch"');
  });

  it("skips main's passes only when the scope step said the diff cannot change the images", () => {
    for (const name of [MAIN1_STEP, MAIN2_STEP]) expect(stepNamed(name)).toContain("if: steps.scope.outputs.applies != 'false'");
    expect(stepNamed(SCOPE_STEP)).toMatch(/^ {8}id: scope$/m);
    expect(ownLines(stepNamed(PR_STEP)).join("\n")).not.toMatch(/^\s+if:/m);
  });
});

describe("main's stack is built with main's own files (D56)", () => {
  it("starts Supabase, migrates and sets the role passwords from main's worktree", () => {
    for (const piece of [
      'supabase_cli start --workdir "$BASE" -x',
      'supabase_cli status --workdir "$BASE" --output env',
      'supabase_cli migration up --local --workdir "$BASE"',
      'cp "$BASE/.env.docker.example" "$BASE/.env.docker"',
      '(cd "$BASE" && node --env-file=.env.docker scripts/set-local-role-passwords.mjs "$db_url")',
      '-f "$BASE/docker-compose.yml"',
      'GIT_REVISION="$(git -C "$BASE" describe --always --dirty --abbrev=12)"',
    ]) {
      expect(AB_SH).toContain(piece);
    }
    // The database URL is checked before anything is written to the database.
    expect(AB_SH.indexOf('require_local_db_url "$db_url"')).toBeLessThan(AB_SH.indexOf("migration up --local"));
  });

  it("names the worktree's folder like the checkout's, so both are one Supabase project", () => {
    expect(AB_SH).toContain('BASE="${D56_BASE_DIR:-${RUNNER_TEMP:?RUNNER_TEMP is not set}/d56/$(basename "$REPO_ROOT")}"');
    expect(AB_SH).toContain("the PR's checkout does not see main's Supabase stack");
  });

  // Each step of local-up.sh and where main-up does the same; a new step there fails here until main-up has it too.
  const MIRROR: Record<string, string> = {
    "Starting Supabase local": "Starting Supabase local from main's tree",
    "Applying pending migrations": "Applying main's pending migrations",
    "Created $ENV_FILE from .env.docker.example": 'cp "$BASE/.env.docker.example" "$BASE/.env.docker"',
    "Added ${line%%=*} to $ENV_FILE from .env.docker.example": 'cp "$BASE/.env.docker.example" "$BASE/.env.docker"',
    "Setting local-only passwords for prisma_app, worker_app and email_enqueuer": "Setting local-only passwords with main's script",
    "Rolling web and worker back to the previous images (network ${SUPABASE_NETWORK})": "Starting main's :base images again",
    "Building and starting web and worker ${GIT_REVISION} (network ${SUPABASE_NETWORK})": "Building and starting main's images ${GIT_REVISION} as :base",
    "Checking http://${WEB_ADDRESS}/api/health": "Checking http://${web_address}/api/health",
    "Checking that the worker consumes system.ping": "Checking that main's worker consumes system.ping",
    "Checking that the worker delivers email to Mailpit (${SMOKE_TO})": "Checking that main's worker delivers email to Mailpit (${smoke_to})",
  };
  it("mirrors every step of local-up.sh", () => {
    const steps = [...LOCAL_UP.matchAll(/^\s*log "(.+)"$/gm)].map((match) => match[1]);
    expect(steps.length).toBeGreaterThan(5);
    for (const step of steps) {
      expect(MIRROR).toHaveProperty([step]);
      expect(AB_SH).toContain(MIRROR[step]);
    }
  });
});

// The script run as CI runs it, against fake commands: git is real, the rest is faked.
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
}
/** A clone of a merge commit like GitHub's: HEAD^1 is main, HEAD^2 the pull request. */
function mergeClone(changePr: (dir: string) => void) {
  const origin = tempDir("d56-origin-");
  git(origin, "init", "-q", "-b", "main");
  mkdirSync(path.join(origin, "scripts/lib"), { recursive: true });
  mkdirSync(path.join(origin, "load"), { recursive: true });
  for (const file of ["scripts/d56-ab.sh", "scripts/d56-ab.mjs", "scripts/d36-diag.mjs", "scripts/k6-comparison-scope.mjs", "scripts/lib/local-db-guard.sh", "scripts/d56-main-images.compose.yml"]) {
    copyFileSync(path.join(REPO, file), path.join(origin, file));
  }
  writeFileSync(path.join(origin, "load/pages.js"), "// harness\n");
  writeFileSync(path.join(origin, ".gitignore"), "load/.out/\n");
  git(origin, "add", "-A");
  git(origin, "commit", "-q", "-m", "base");
  git(origin, "checkout", "-q", "-b", "pr");
  changePr(origin);
  git(origin, "add", "-A");
  git(origin, "commit", "-q", "--allow-empty", "-m", "pr");
  const prHead = git(origin, "rev-parse", "HEAD");
  git(origin, "checkout", "-q", "main");
  git(origin, "merge", "-q", "--no-ff", "-m", "merge", "pr");
  const clone = path.join(tempDir("d56-clone-"), "ScaliaHR");
  git(path.dirname(clone), "clone", "-q", "--depth=2", `file://${origin}`, clone);
  return { clone, prHead, mainSha: git(clone, "rev-parse", "HEAD^1") };
}
function runAb(cwd: string, args: string[], fakes: Record<string, string> = {}, env: Record<string, string> = {}) {
  const bin = path.join(tempDir("d56-bin-"), "bin");
  mkdirSync(bin);
  for (const [command, body] of Object.entries(fakes)) writeFileSync(path.join(bin, command), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  const runnerTemp = tempDir("d56-runner-");
  return spawnSync("bash", ["scripts/d56-ab.sh", ...args], { cwd, encoding: "utf-8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: runnerTemp, ...env } });
}

describe("scripts/d56-ab.sh, run as CI runs it (D56)", { timeout: 30_000 }, () => {
  it("tree: checks out HEAD^1 in a folder named like the checkout, records the diff and prints both SHAs", () => {
    const { clone, prHead, mainSha } = mergeClone((dir) => writeFileSync(path.join(dir, "docs.md"), "# x\n"));
    const base = path.join(tempDir("d56-base-"), "ScaliaHR");
    const result = runAb(clone, ["tree"], {}, { PR_HEAD: prHead, D56_BASE_DIR: base });
    expect(result.status).toBe(0);
    expect(git(base, "rev-parse", "HEAD")).toBe(mainSha);
    const tree = JSON.parse(readFileSync(path.join(clone, "load/.out/d56-tree.json"), "utf-8"));
    expect(tree).toMatchObject({ base_sha: mainSha, head_sha: git(clone, "rev-parse", "HEAD"), diff_files: 1, harness_changed: false });
    expect(tree.markdown["docs.md"].head).toMatch(/^[0-9a-f]{64}$/);
    expect(result.stdout).toContain(`D56-ab: tree base_sha=${mainSha} head_sha=${tree.head_sha} `);
  });

  it("tree: marks a diff that touches the harness", () => {
    const { clone, prHead } = mergeClone((dir) => writeFileSync(path.join(dir, "load/pages.js"), "// changed harness\n"));
    const result = runAb(clone, ["tree"], {}, { PR_HEAD: prHead, D56_BASE_DIR: path.join(tempDir("d56-base-"), "ScaliaHR") });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("harness=changed");
  });

  it("tree: fails when HEAD is not the pull request's merge commit", () => {
    const { clone } = mergeClone(() => {});
    const result = runAb(clone, ["tree"], {}, { PR_HEAD: "c".repeat(40), D56_BASE_DIR: path.join(tempDir("d56-base-"), "ScaliaHR") });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('::error::D56: HEAD is not the merge commit of this pull request ("sin referencia")');
  });

  it("main-up: fails before Supabase starts when main's worktree is not at HEAD^1", () => {
    const { clone, prHead } = mergeClone((dir) => writeFileSync(path.join(dir, "x.txt"), "x\n"));
    const base = path.join(tempDir("d56-base-"), "ScaliaHR");
    expect(runAb(clone, ["tree"], {}, { PR_HEAD: prHead, D56_BASE_DIR: base }).status).toBe(0);
    git(base, "checkout", "-q", "--detach", prHead);
    const calls = path.join(tempDir("d56-calls-"), "calls");
    const result = runAb(clone, ["main-up", "build"], { supabase: `echo "supabase $*" >> ${calls}` }, { D56_BASE_DIR: base });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("main's worktree is at");
    expect(existsSync(calls)).toBe(false);
  });

  it("main-up: refuses a database that is not local before it migrates or starts anything", () => {
    const { clone, prHead } = mergeClone(() => {});
    const base = path.join(tempDir("d56-base-"), "ScaliaHR");
    expect(runAb(clone, ["tree"], {}, { PR_HEAD: prHead, D56_BASE_DIR: base }).status).toBe(0);
    const calls = path.join(tempDir("d56-calls-"), "calls");
    const supabase = [`echo "supabase $*" >> ${calls}`, 'case "$1" in status) echo \'DB_URL="postgresql://postgres:postgres@db.example.com:5432/postgres"\' ;; esac'].join("\n");
    const result = runAb(clone, ["main-up", "build"], { supabase, docker: `echo "docker $*" >> ${calls}` }, { D56_BASE_DIR: base });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the database URL is not the local Supabase stack");
    const log = readFileSync(calls, "utf-8");
    expect(log).not.toContain("migration");
    expect(log).not.toContain("docker");
  });

  it("main-up: a failing Supabase start is \"sin referencia\"", () => {
    const { clone, prHead } = mergeClone(() => {});
    const base = path.join(tempDir("d56-base-"), "ScaliaHR");
    expect(runAb(clone, ["tree"], {}, { PR_HEAD: prHead, D56_BASE_DIR: base }).status).toBe(0);
    const result = runAb(clone, ["main-up", "reuse"], { supabase: "exit 1" }, { D56_BASE_DIR: base });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('::error::D56: supabase start failed for main\'s tree ("sin referencia")');
  });

  it("down: deletes Supabase's data and fails when a container, volume or network is left, or port 3000 answers", () => {
    const { clone } = mergeClone(() => {});
    const calls = path.join(tempDir("d56-calls-"), "calls");
    const clean = { supabase: `echo "supabase $*" >> ${calls}`, docker: `echo "docker $*" >> ${calls}`, curl: "exit 7" };
    const ok = runAb(clone, ["down"], clean);
    expect(ok.status).toBe(0);
    expect(readFileSync(calls, "utf-8")).toContain("supabase stop --no-backup\n");
    expect(readFileSync(calls, "utf-8")).toContain("docker compose -p scaliahr --env-file .env.docker.example down --remove-orphans\n");
    for (const [what, docker] of [
      ["a container", 'case "$1" in ps) echo supabase_db_ScaliaHR ;; esac'],
      ["a volume", 'case "$1" in volume) echo supabase_db_ScaliaHR ;; esac'],
      ["a network", 'case "$1" in network) echo supabase_network_ScaliaHR ;; esac'],
      ["the web container", 'case "$1" in ps) echo scaliahr-web-1 ;; esac'],
    ]) {
      const left = runAb(clone, ["down"], { ...clean, docker });
      expect(left.status, what).toBe(1);
      expect(left.stderr).toContain("the stack was not cleaned up");
    }
    const busy = runAb(clone, ["down"], { ...clean, curl: "exit 0" });
    expect(busy.status).toBe(1);
    expect(busy.stderr).toContain("something still answers on port 3000");
  });

  it("k6: runs the PR's harness with its own files, keeps k6's output out of the log, and records the pass", () => {
    const { clone, prHead } = mergeClone(() => {});
    const base = path.join(tempDir("d56-base-"), "ScaliaHR");
    expect(runAb(clone, ["tree"], {}, { PR_HEAD: prHead, D56_BASE_DIR: base }).status).toBe(0);
    const out = path.join(clone, "load/.out");
    const fixture = tempDir("d56-fixture-");
    writeFileSync(path.join(fixture, "summary.json"), JSON.stringify(summaryOf({})));
    writeFileSync(path.join(fixture, "requests.csv.gz"), csvOf({}));
    const npm = [
      '[ "$*" = "run load:test -- --out csv=fileName=/out/requests-main-1.csv.gz,timeFormat=unix_milli" ] || { echo "unexpected npm $*" >&2; exit 9; }',
      '[ "$LOAD_SUMMARY" = summary-main-1.json ] || exit 8',
      `cp ${fixture}/summary.json ${out}/summary-main-1.json`,
      `cp ${fixture}/requests.csv.gz ${out}/requests-main-1.csv.gz`,
      'echo "      { kind:page,phase:steady }...: avg=60ms p(95)=60ms"',
    ].join("\n");
    const docker = [
      'case "$*" in',
      `  "inspect -f {{.Image}} scaliahr-web-1") echo ${MAIN_IMAGE.web} ;;`,
      `  "inspect -f {{.Image}} scaliahr-worker-1") echo ${MAIN_IMAGE.worker} ;;`,
      `  "image inspect -f {{.Id}} scaliahr-web:base") echo ${MAIN_IMAGE.web} ;;`,
      `  "image inspect -f {{.Id}} scaliahr-worker:base") echo ${MAIN_IMAGE.worker} ;;`,
      '  "image inspect -f {{index .Config.Labels "*) git rev-parse --short=12 HEAD^1 ;;',
      '  *) echo "unexpected docker $*" >&2; exit 9 ;;',
      "esac",
    ].join("\n");
    const result = runAb(clone, ["k6", "main-1"], { npm, docker }, { ...PARAMS, GITHUB_RUN_ATTEMPT: "1", D56_BASE_DIR: base });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/phase:steady|p\(95\)/);
    expect(result.stdout).toMatch(/^D56-ab: pass pass=main-1 role=main stack=fresh p95_steady_ms=60\.00 samples=600 k6_exit=0 /m);
    expect(readFileSync(path.join(out, "k6-main-1.txt"), "utf-8")).toContain("{ kind:page,phase:steady }");
    expect(JSON.parse(readFileSync(path.join(out, "d56-pass-main-1.json"), "utf-8"))).toMatchObject({ pass: "main-1", k6_exit: "0", params: PARAMS });
  });

  it("k6: a main pass whose run broke is \"sin referencia\", with its output's tail and no p95 line", () => {
    const { clone, prHead } = mergeClone(() => {});
    const base = path.join(tempDir("d56-base-"), "ScaliaHR");
    expect(runAb(clone, ["tree"], {}, { PR_HEAD: prHead, D56_BASE_DIR: base }).status).toBe(0);
    const npm = 'echo "ERRO[0001] setup failed"; echo "      { kind:page,phase:steady }...: p(95)=1ms"; exit 107';
    const result = runAb(clone, ["k6", "main-2"], { npm, docker: "exit 9" }, { ...PARAMS, GITHUB_RUN_ATTEMPT: "1", D56_BASE_DIR: base });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("  ERRO[0001] setup failed");
    expect(result.stderr).not.toMatch(/phase:steady|p\(95\)/);
    expect(result.stderr).toContain('::error::D56: main-2: k6 exited "107"; its output is in the D56 artifact ("sin referencia")');
  });
});

describe("the D56 artifact and the scope step's output (D56)", () => {
  it("uploads an explicit list, never accounts.json or a wildcard, and never fails the job", () => {
    const step = stepNamed(ARTIFACT_STEP);
    expect(step).toContain("if: always() && hashFiles('load/.out/d56-tree.json') != ''");
    expect(step).toMatch(/^ {8}continue-on-error: true$/m);
    expect(step).toContain("name: d56-ab-attempt-${{ github.run_attempt }}");
    expect(step).not.toContain("accounts");
    expect(step).not.toContain("*");
  });

  it("the scope script writes its verdict for later steps", () => {
    const work = tempDir("d56-scope-");
    const output = path.join(work, "output");
    for (const [input, applies] of [
      ["docs/a.md\0", "false"],
      ["apps/web/src/a.ts\0", "true"],
    ]) {
      writeFileSync(output, "");
      const result = spawnSync("node", [path.join(REPO, "scripts/k6-comparison-scope.mjs")], { input, encoding: "utf-8", env: { ...process.env, GITHUB_OUTPUT: output } });
      expect(result.status).toBe(0);
      expect(readFileSync(output, "utf-8")).toBe(`applies=${applies}\n`);
    }
  });
});
