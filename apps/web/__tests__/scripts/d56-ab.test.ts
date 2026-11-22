import { afterAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  CEILING,
  CORRECTNESS_THRESHOLDS,
  GateError,
  IMAGES,
  LIMIT,
  LOAD_PARAMS,
  MIN_STEADY_PAGES,
  ORDER,
  PASSES,
  SENTINELS,
  VERDICTS,
  WARMUPS,
  WARMUP_OF,
  abLine,
  brokenRunVerdict,
  checkWarmup,
  decide,
  filesInImages,
  loadParams,
  parseListing,
  passLine,
  ratio,
  ratioLine,
  runAttempt,
  treeRecord,
  validatePass,
  verdict,
  warmLine,
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
const LOCAL_UP_STEP = "Build images and start the local stack (npm run local:up)";
const ISOLATION_STEP = "Tenant isolation held in the second k6 pass (D54)";
const EXPORT_STEP = "Per-tenant export through the running worker (D23)";
const ROLLBACK_STEP = "Rollback drill (D24)";

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
/**
 * The environment for a spawned script: this process's, without GitHub's step
 * files and run settings (so a test run in CI never writes to the job's summary
 * or outputs) and without the user's git config (signing, hooks).
 */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...extra };
  for (const key of Object.keys(env)) {
    if ((key.startsWith("GITHUB_") || key.startsWith("RUNNER_")) && !(key in extra)) delete env[key];
  }
  return env;
}

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
/** The lines of the step's `run: |` block, without their indentation. */
function runLines(step: string): string[] {
  const lines = step.split("\n");
  const start = lines.indexOf("        run: |");
  if (start === -1) throw new Error("the step has no run: | block");
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("          ")) break;
    block.push(line.slice(10));
  }
  return block;
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
/** The record of a main pass's warm-up as `record warm-main-N` writes it: its pass's settings and images, run 2 min before it. */
function warmRecordOf(main: string, overrides: Record<string, unknown> = {}) {
  const name = WARMUP_OF[main as keyof typeof WARMUP_OF];
  const spec = WARMUPS[name as keyof typeof WARMUPS];
  return { ...recordOf(main), pass: name, role: "warm", of: main, summary: spec.summary, csv: spec.csv, p95: 70, first_request: START[main] - 120_000, isolation_fails: 0, ...overrides };
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
      diff_sha256: createHash("sha256").update(diff).digest("hex"),
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
  warmups = {} as Record<string, Record<string, unknown> | null>,
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
    const warm = WARMUP_OF[name as keyof typeof WARMUP_OF];
    if (warm && warmups[name] !== null) {
      // The warm-up shares its pass's settings, harness, attempt and images unless a test says otherwise.
      const inherited = Object.fromEntries(Object.entries(records[name] ?? {}).filter(([key]) => ["params", "harness", "run_attempt", "web_image", "worker_image"].includes(key)));
      files.set(`d56-pass-${warm}.json`, Buffer.from(JSON.stringify(warmRecordOf(name, { ...inherited, ...warmups[name] }))));
    }
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

// The ratio step as CI runs it: the files of the test's world in load/.out, the script run with the step's env.
function runRatio(w: World, env: Record<string, string> = {}) {
  const work = tempDir("d56-ratio-");
  const out = path.join(work, "load/.out");
  mkdirSync(out, { recursive: true });
  for (const [file, bytes] of w.files) writeFileSync(path.join(out, file), bytes);
  const result = spawnSync(process.execPath, [path.join(REPO, "scripts/d56-ab.mjs"), "ratio"], {
    cwd: work,
    encoding: "utf-8",
    env: cleanEnv({ GITHUB_EVENT_NAME: "pull_request", SCOPE_APPLIES: "true", GITHUB_RUN_ATTEMPT: "1", ...env }),
  });
  const ratioFile = path.join(out, "d56-ratio.json");
  return { result, ratio: existsSync(ratioFile) ? JSON.parse(readFileSync(ratioFile, "utf-8")) : null };
}

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
    const result = spawnSync(process.execPath, [path.join(REPO, "scripts/d56-ab.mjs"), "ratio"], {
      cwd: work,
      encoding: "utf-8",
      env: cleanEnv({ GITHUB_EVENT_NAME: "pull_request", SCOPE_APPLIES: "true", GITHUB_RUN_ATTEMPT: "1" }),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^::error::D56: d56-tree\.json is missing.*\("sin referencia"\)$/m);
  });

  it("prints the ratio line and writes d56-ratio.json from four valid passes, on a pull request and on a push", () => {
    const pr = runRatio(world());
    expect(pr.result.stderr).toBe("");
    expect(pr.result.status).toBe(0);
    expect(pr.result.stdout).toContain('D56-ab: ratio r=1.0000 limit=1.20 main_ms="60.00,60.00" pr_ms="60.00,60.00" scope=applies event=pull_request attempt=1 verdict="within the limit"');
    expect(pr.ratio).toMatchObject({ r: 1, applies: true, attempt: 1, pass: true, label: null });
    const push = runRatio(world(), { GITHUB_EVENT_NAME: "push", SCOPE_APPLIES: "" });
    expect(push.result.status).toBe(0);
    expect(push.result.stdout).toContain("scope=applies event=push attempt=1");
    expect(ratioLine(decideIn(world()))).toContain(" event=pull_request ");
  });

  it("fails the step above the limit, after printing the ratio line and writing d56-ratio.json", () => {
    const { result, ratio: written } = runRatio(world({ options: { "pr-1": { p95: 80 }, "pr-2": { p95: 80 } } }));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('D56-ab: ratio r=1.3333 limit=1.20 main_ms="60.00,60.00" pr_ms="80.00,80.00" scope=applies event=pull_request attempt=1');
    expect(result.stderr).toContain(`::error::D56: r 1.3333 is above 1.2 on the first attempt: one re-run of the docker job is allowed ("${VERDICTS.overFirst}")`);
    expect(written).toMatchObject({ pass: false, label: VERDICTS.overFirst });
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
    expect(gateError(() => validate("main-1", { failedFlag: true })).message).toContain("the run's own threshold http_req_failed{kind:page} rate<0.01 was crossed");
    expect(gateError(() => validate("main-1", { failedFlag: null })).message).toContain("has no result");
    expect(validate("main-1", { p95: 650 }).p95).toBe(650);
  });

  it.each(CORRECTNESS_THRESHOLDS.map((key) => [key, key.includes(ISOLATION_CHECK) ? "a summary in an unknown format" : `the summary has no threshold on ${key}`]))(
    "refuses a summary without the correctness threshold on %s",
    (key, message) => {
      const summary = summaryOf({});
      delete (summary.metrics as Record<string, { thresholds?: unknown }>)[key].thresholds;
      const error = gateError(() => validatePass("main-1", recordOf("main-1"), summary, readCsvRows(csvOf({})), validTree));
      expect(error.verdict).toBe(VERDICTS.noReference);
      expect(error.message).toContain(message);
    },
  );

  it.each([
    ["crossed", true],
    ["without a result", null],
  ])("refuses any other threshold of the run %s, outside the correctness list and the ceiling", (_what, flag) => {
    const summary = summaryOf({});
    (summary.metrics["http_reqs{kind:auth,phase:ramp}"] as { thresholds: Record<string, unknown> }).thresholds["count>=0"] = flag;
    const error = gateError(() => validatePass("main-1", recordOf("main-1"), summary, readCsvRows(csvOf({})), validTree));
    expect(error.verdict).toBe(VERDICTS.noReference);
    expect(error.message).toContain("the threshold http_reqs{kind:auth,phase:ramp} count>=0 was crossed");
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
  it("refuses a pass whose recorded image ids are not image ids", () => {
    for (const key of ["web_image", "worker_image", "expected_web", "expected_worker"]) {
      expect(gateError(() => validate("main-1", {}, { [key]: "" })).message).toContain(`its ${key} "" is not an image id`);
    }
    expect(gateError(() => validate("pr-1", {}, { web_image: undefined, expected_web: undefined })).message).toContain("its web_image null is not an image id");
  });

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

  it("fails the first attempt above the limit and allows one re-run, then blocks on the re-run", () => {
    const slow = { "pr-1": { p95: 80 }, "pr-2": { p95: 80 } };
    const first = decideIn(world({ options: slow }));
    expect(first.pass).toBe(false);
    expect(first.r).toBeCloseTo(80 / 60, 12);
    expect(first.verdict).toContain("r 1.3333 is above 1.2 on the first attempt: one re-run of the docker job is allowed");
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
      `D56-ab: pass pass=main-1 role=main stack=warmed p95_steady_ms=66.02 samples=942 k6_exit=0 web_image=${MAIN_IMAGE.web} revision=${BASE_REV} cpu="AMD EPYC 9V74 80-Core Processor" harness=0123456789ab params="LOAD_BIG_USERS=60,LOAD_SMALL_USERS=5,LOAD_VUS=60,SMALL_VUS=5,RAMP=20s,HOLD=40s,THINK_MIN=2,THINK_MAX=6" attempt=1`,
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

describe("main's stack is warmed before each of main's passes (D56, 2026-11-21)", () => {
  it("gives each warm-up files of its own, apart from every measured pass's", () => {
    expect(WARMUP_OF).toEqual({ "main-1": "warm-main-1", "main-2": "warm-main-2" });
    const files = [...Object.values(PASSES), ...Object.values(WARMUPS)].flatMap((spec) => [spec.summary, spec.csv, spec.output].filter(Boolean));
    expect(new Set(files).size).toBe(files.length);
    for (const [name, spec] of Object.entries(WARMUPS)) {
      expect(spec).toMatchObject({ summary: `summary-${name}.json`, csv: `requests-${name}.csv.gz`, output: `k6-${name}.txt` });
    }
  });

  it("measures main's passes on a warmed stack and says so, and prints each warm-up as not measured", () => {
    const decision = decideIn(world());
    expect(decision.pass).toBe(true);
    expect(Object.keys(decision.warmups)).toEqual(["main-1", "main-2"]);
    expect(passLine("main-2", decision.passes["main-2"].record, decision.passes["main-2"].measured)).toContain(" stack=warmed ");
    const line = warmLine("warm-main-1", decision.warmups["main-1"]);
    expect(line).toMatch(/^D56-ab: warm pass=warm-main-1 of=main-1 measured=no p95_steady_ms=70\.00 k6_exit=0 /);
    expect(line).not.toMatch(/phase:steady|p\(95\)/);
    const { result } = runRatio(world());
    expect(result.status).toBe(0);
    const lines = result.stdout.split("\n").filter((l) => l.startsWith("D56-ab: "));
    expect(lines.map((l) => /^D56-ab: (\w+) pass=([\w-]+)/.exec(l)?.slice(1).join(" ") ?? l.split(" ")[1])).toEqual([
      "warm warm-main-1",
      "pass main-1",
      "pass pr-1",
      "pass pr-2",
      "warm warm-main-2",
      "pass main-2",
      "ratio",
    ]);
  });

  it.each(["main-1", "main-2"])('leaves %s "sin referencia" without its warm-up, and the harness\'s when the PR changed it', (main) => {
    const missing = gateError(() => decideIn(world({ warmups: { [main]: null } })));
    expect(missing.verdict).toBe(VERDICTS.noReference);
    expect(missing.message).toBe(`${main}: its warm-up ${WARMUP_OF[main as keyof typeof WARMUP_OF]} was not recorded`);
    expect(gateError(() => decideIn(world({ warmups: { [main]: null }, harnessChanged: true }))).verdict).toBe(VERDICTS.harness);
  });

  it.each([
    ["0", true],
    ["99", true],
    ["107", false],
    ["d36-step-failure", false],
    ["", false],
  ])("takes a warm-up whose k6 exited %j: %s", (exit, ok) => {
    const w = world({ warmups: { "main-1": { k6_exit: exit } } });
    if (ok) expect(decideIn(w).pass).toBe(true);
    else expect(gateError(() => decideIn(w))).toMatchObject({ verdict: VERDICTS.noReference, message: `main-1: its warm-up warm-main-1 ran, but k6 exited ${JSON.stringify(exit)}` });
  });

  it.each([
    ["no p95", { p95: 0 }, VERDICTS.noReference, "main-2: its warm-up warm-main-2 left no steady-state p95"],
    ["a first request that is not a time", { first_request: "5" }, VERDICTS.noReference, "main-2: its warm-up warm-main-2 left no first request time"],
    ["no isolation count", { isolation_fails: undefined }, VERDICTS.noReference, "main-2: its warm-up warm-main-2 left no tenant-isolation count"],
    ["a page with another tenant's employees", { isolation_fails: 2 }, VERDICTS.mainIsolation, "warm-main-2: 2 page(s) showed another tenant's employees"],
    ["another pass's record", { of: "main-1" }, VERDICTS.noReference, "main-2: its warm-up warm-main-2 has a record that is not its own"],
    ["other settings", { params: { ...PARAMS, HOLD: "30s" } }, VERDICTS.mismatch, "warm-main-2 ran with HOLD=30s, main-2 with 40s"],
    ["another harness", { harness: "fedcba987654" }, VERDICTS.mismatch, "warm-main-2 ran another harness than main-2"],
    ["another attempt", { run_attempt: "2" }, VERDICTS.mismatch, "warm-main-2 was recorded in attempt 2, main-2 in attempt 1"],
    ["another web image", { web_image: PR_IMAGE.web }, VERDICTS.mismatch, "warm-main-2 warmed other images than main-2 measured"],
    ["another worker image", { worker_image: PR_IMAGE.worker }, VERDICTS.mismatch, "warm-main-2 warmed other images than main-2 measured"],
    ["a start after its pass", { first_request: START["main-2"] + 1 }, VERDICTS.mismatch, "warm-main-2 did not run right before main-2"],
    ["a start before the pass before it", { first_request: START["pr-2"] - 1 }, VERDICTS.mismatch, "warm-main-2 did not run right before main-2"],
  ])("refuses a warm-up with %s", (_what, warm, verdictLabel, message) => {
    expect(gateError(() => decideIn(world({ warmups: { "main-2": warm } })))).toMatchObject({ verdict: verdictLabel, message });
  });

  it("checks main-1's warm-up with no pass before it, and leaves pr-1 and pr-2 without one", () => {
    const tree = validTree;
    const record = recordOf("main-1");
    expect(() => checkWarmup("main-1", warmRecordOf("main-1"), record, START["main-1"], null, tree)).not.toThrow();
    expect(() => checkWarmup("pr-1", warmRecordOf("main-1"), recordOf("pr-1"), START["pr-1"], null, tree)).toThrow("pr-1 has no warm-up");
    const docsOnly = world({ passes: ["pr-1", "pr-2"], diffFiles: ["docs/a.md"], markdown: { "docs/a.md": { head: "d".repeat(64), base: null } } });
    expect(decideIn(docsOnly, { scopeApplies: "false" })).toMatchObject({ pass: true, warmups: {} });
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

describe("the docker job runs the passes in the order main, PR, PR, main (D56)", () => {
  it("places every D56 step where its pass belongs", () => {
    const names = dockerSteps().map(stepName);
    const order = [SCOPE_STEP, TREE_STEP, MAIN1_STEP, LOCAL_UP_STEP, D36_STEP, SECOND_STEP, ISOLATION_STEP, PR_STEP, EXPORT_STEP, ROLLBACK_STEP, MAIN2_STEP, RATIO_STEP, ARTIFACT_STEP];
    const at = order.map((name) => names.indexOf(name));
    expect(at).not.toContain(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // main-1 deletes its stack right before the PR's local:up.
    expect(names.indexOf(LOCAL_UP_STEP)).toBe(names.indexOf(MAIN1_STEP) + 1);
  });

  it("runs main-1 as main-up, its warm-up, k6 and down, and main-2 from the PR's stack stopped, on main's images as built, warmed first", () => {
    expect(runLines(stepNamed(MAIN1_STEP))).toEqual([
      "bash scripts/d56-ab.sh main-up build",
      "bash scripts/d56-ab.sh k6 warm-main-1",
      "bash scripts/d56-ab.sh k6 main-1",
      "bash scripts/d56-ab.sh down",
    ]);
    expect(runLines(stepNamed(MAIN2_STEP))).toEqual([
      "bash scripts/d56-ab.sh down",
      "bash scripts/d56-ab.sh main-up reuse",
      "bash scripts/d56-ab.sh k6 warm-main-2",
      "bash scripts/d56-ab.sh k6 main-2",
      "node scripts/d56-ab.mjs images main",
    ]);
  });

  it("records pr-1 from the D36 step's outcome and pr-2 from the exit code the D54 pass wrote", () => {
    expect(stepNamed(D36_STEP)).toMatch(/^ {8}id: d36_first$/m);
    expect(envBlock(stepNamed(PR_STEP)).PR_FIRST_OUTCOME).toBe("${{ steps.d36_first.outcome }}");
    expect(runLines(stepNamed(PR_STEP))).toEqual([
      'case "$PR_FIRST_OUTCOME" in success) first=0 ;; *) first="d36-step-${PR_FIRST_OUTCOME:-unknown}" ;; esac',
      'node scripts/d56-ab.mjs record pr-1 "$first"',
      'node scripts/d56-ab.mjs record pr-2 "$(cat load/.out/k6-exit-second.txt)"',
      "node scripts/d56-ab.mjs images pr",
    ]);
    const second = runLines(stepNamed(SECOND_STEP));
    const k6 = second.findIndex((line) => line.includes("npm run load:test"));
    expect(k6).toBeGreaterThan(-1);
    expect(second[k6 + 1]).toBe(`printf '%s\\n' "$code" > load/.out/k6-exit-second.txt # D56: this pass is also pr-2 of the A/B ratio`);
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
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanEnv({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }) }).trim();
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
  // Main's own files that main-up uses from the worktree; this script records how it was run.
  writeFileSync(path.join(origin, ".env.docker.example"), "EXAMPLE=1\n");
  writeFileSync(path.join(origin, "docker-compose.yml"), "services: {}\n");
  writeFileSync(
    path.join(origin, "scripts/set-local-role-passwords.mjs"),
    'import { appendFileSync } from "node:fs";\nappendFileSync(process.env.CALLS, `passwords ${process.cwd()} ${process.argv.slice(2).join(" ")}\\n`);\n',
  );
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
  return spawnSync("bash", ["scripts/d56-ab.sh", ...args], { cwd, encoding: "utf-8", env: cleanEnv({ PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: runnerTemp, ...env }) });
}

// Fakes for main-up's whole run: Supabase, Docker, npm and curl as main's stack answers them.
const MAIN_UP_FAKES = {
  supabase: [
    'echo "supabase $*" >> "$CALLS"',
    'case "$1" in',
    "  status)",
    "    cat <<EOF",
    'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
    'API_URL="http://127.0.0.1:54321"',
    'ANON_KEY="${ANON:-anon-key}"',
    'MAILPIT_URL="http://127.0.0.1:54324"',
    "EOF",
    "    ;;",
    "esac",
  ].join("\n"),
  docker: [
    'echo "docker $*" >> "$CALLS"',
    'case "$*" in',
    '  "ps --filter publish=54322 --format {{.Names}}") echo supabase_db_ScaliaHR ;;',
    '  "ps --filter publish=54324 --format {{.Names}}") echo supabase_inbucket_ScaliaHR ;;',
    '  "inspect -f {{range"*) printf "bridge\\nsupabase_network_ScaliaHR\\n" ;;',
    '  "image inspect scaliahr-"*) [ -z "${NO_BASE:-}" ] ;;',
    '  "image inspect -f "*) echo 0123456789ab ;;',
    '  *" up "*) echo "env SUPABASE_NETWORK=$SUPABASE_NETWORK MAILPIT_HOST=$MAILPIT_HOST ANON=$NEXT_PUBLIC_SUPABASE_ANON_KEY" >> "$CALLS" ;;',
    '  *" port web 3000") echo "${WEB_ADDRESS:-127.0.0.1:3000}" ;;',
    '  *" exec -T worker "*) ;;',
    '  *) echo "unexpected docker $*" >&2; exit 9 ;;',
    "esac",
  ].join("\n"),
  npm: 'echo "npm $* in $(pwd)" >> "$CALLS"',
  curl: [
    'echo "curl $*" >> "$CALLS"',
    'case "$*" in',
    '  *"/api/health") echo "{}" ;;',
    '  *"/api/v1/search"*) [ -z "${SEARCH_FAILS:-}" ] || exit 22; echo "{\\"messages_count\\":${MAILPIT_COUNT:-1}}" ;;',
    "  *) exit 7 ;;",
    "esac",
  ].join("\n"),
};
/** A merge clone with main's tree checked out, and main-up run in it against MAIN_UP_FAKES, each run with its own call log. */
function mainUpWorld() {
  const { clone, prHead } = mergeClone(() => {});
  const base = path.join(tempDir("d56-base-"), "ScaliaHR");
  expect(runAb(clone, ["tree"], {}, { PR_HEAD: prHead, D56_BASE_DIR: base }).status).toBe(0);
  const mainUp = (mode: string, env: Record<string, string> = {}) => {
    const calls = path.join(tempDir("d56-calls-"), "calls");
    writeFileSync(calls, "");
    const result = runAb(clone, ["main-up", mode], MAIN_UP_FAKES, { D56_BASE_DIR: base, CALLS: calls, SUPABASE_EXCLUDE: "realtime,storage-api", ...env });
    return { result, calls: readFileSync(calls, "utf-8").split("\n").filter(Boolean) };
  };
  return { clone, base, mainUp };
}

/** scripts/d56-ab.mjs run in `cwd` as CI runs it, with fake commands first on the PATH. */
function runNode(cwd: string, args: string[], fakes: Record<string, string> = {}, env: Record<string, string> = {}) {
  const bin = path.join(tempDir("d56-bin-"), "bin");
  mkdirSync(bin);
  for (const [command, body] of Object.entries(fakes)) writeFileSync(path.join(bin, command), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  return spawnSync(process.execPath, ["scripts/d56-ab.mjs", ...args], { cwd, encoding: "utf-8", env: cleanEnv({ PATH: `${bin}:${process.env.PATH}`, ...env }) });
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

  it.each([
    ["database", 'DB_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"\nAPI_URL="http://127.0.0.1:54321"'],
    ["API", 'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"\nAPI_URL="http://127.0.0.1:54421"'],
  ])("main-up: fails before it migrates when the PR's checkout sees another Supabase %s", (_what, prStatus) => {
    const { clone, prHead } = mergeClone(() => {});
    const base = path.join(tempDir("d56-base-"), "ScaliaHR");
    expect(runAb(clone, ["tree"], {}, { PR_HEAD: prHead, D56_BASE_DIR: base }).status).toBe(0);
    const calls = path.join(tempDir("d56-calls-"), "calls");
    const mainStatus = 'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"\nAPI_URL="http://127.0.0.1:54321"';
    const supabase = [
      `echo "supabase $*" >> ${calls}`,
      'case "$*" in',
      `  "status --workdir "*) printf '%s\\n' '${mainStatus.replace("\n", "' '")}' ;;`,
      `  "status --output env") printf '%s\\n' '${prStatus.replace("\n", "' '")}' ;;`,
      "esac",
    ].join("\n");
    const result = runAb(clone, ["main-up", "build"], { supabase, docker: `echo "docker $*" >> ${calls}` }, { D56_BASE_DIR: base });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('::error::D56: the PR\'s checkout does not see main\'s Supabase stack ("sin referencia")');
    const log = readFileSync(calls, "utf-8");
    expect(log).toContain("supabase status --output env\n");
    expect(log).not.toContain("migration");
    expect(log).not.toContain("docker");
  });

  it("main-up build: migrates and sets main's passwords from its worktree, then builds main's images as :base and checks them", () => {
    const { clone, base, mainUp } = mainUpWorld();
    const { result, calls } = mainUp("build");
    expect(result.status).toBe(0);
    const compose = `docker compose -p scaliahr -f ${base}/docker-compose.yml -f ${clone}/scripts/d56-main-images.compose.yml --env-file ${base}/.env.docker`;
    const expected = [
      `supabase start --workdir ${base} -x realtime,storage-api`,
      `supabase migration up --local --workdir ${base}`,
      `npm ci --ignore-scripts --no-audit --no-fund in ${base}`,
      `passwords ${base} postgresql://postgres:postgres@127.0.0.1:54322/postgres`,
      `${compose} up --build --detach --wait --wait-timeout 300`,
      "env SUPABASE_NETWORK=supabase_network_ScaliaHR MAILPIT_HOST=supabase_inbucket_ScaliaHR ANON=anon-key",
      "curl -fsS http://127.0.0.1:3000/api/health",
      `${compose} exec -T worker node dist/smoke.js`,
    ];
    let at = -1;
    for (const line of expected) {
      const next = calls.indexOf(line, at + 1);
      expect(next, line).toBeGreaterThan(at);
      at = next;
    }
    expect(calls.slice(at + 1).some((line) => line.startsWith(`${compose} exec -T worker node dist/smoke.js email smoke-d56-`))).toBe(true);
    expect(calls.at(-1)).toMatch(/^curl -fsS http:\/\/127\.0\.0\.1:54324\/api\/v1\/search\?query=to:smoke-d56-\d+@scaliahr\.localhost$/);
    expect(readFileSync(path.join(clone, "load/.out/d56-main-anon-key.sha256"), "utf-8")).toBe(`${createHash("sha256").update("anon-key").digest("hex")}\n`);
    expect(result.stdout).toContain(`Main's stack is up: ${git(base, "describe", "--always", "--abbrev=12")}.`);
  });

  it("main-up reuse: starts the :base images built before without rebuilding them, and only with the same anon key", () => {
    const { clone, base, mainUp } = mainUpWorld();
    expect(mainUp("build").result.status).toBe(0);
    const compose = `docker compose -p scaliahr -f ${base}/docker-compose.yml -f ${clone}/scripts/d56-main-images.compose.yml --env-file ${base}/.env.docker`;
    const composeUp = (calls: string[]) => calls.filter((line) => line.startsWith(`${compose} up `));
    const reuse = mainUp("reuse");
    expect(reuse.result.status).toBe(0);
    expect(composeUp(reuse.calls)).toEqual([`${compose} up --no-build --force-recreate --detach --wait --wait-timeout 300`]);
    for (const [env, message] of [
      [{ ANON: "another-key" }, "main's web image was built with another anon key"],
      [{ NO_BASE: "1" }, "there is no scaliahr-web:base to reuse"],
    ] as const) {
      const run = mainUp("reuse", env);
      expect(run.result.status).toBe(1);
      expect(run.result.stderr).toContain(`::error::D56: ${message} ("sin referencia")`);
      expect(composeUp(run.calls)).toEqual([]);
    }
  });

  it.each([
    ["answers on another address", { WEB_ADDRESS: "127.0.0.1:3001" }, "main's web answers on 127.0.0.1:3001, not 127.0.0.1:3000"],
    ["cannot search Mailpit", { SEARCH_FAILS: "1" }, "main's Mailpit search failed"],
    ["finds no smoke email in Mailpit", { MAILPIT_COUNT: "0" }, "main's smoke email did not reach Mailpit"],
  ])('main-up: a stack that %s is "sin referencia"', (_what, env, message) => {
    const { result } = mainUpWorld().mainUp("build", env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`::error::D56: ${message} ("sin referencia")`);
  });

  it("refuses a main-up mode and a k6 pass it does not run, and a tree that already exists; a push needs no pull request head", () => {
    const { clone, mainSha } = mergeClone(() => {});
    const base = path.join(tempDir("d56-base-"), "ScaliaHR");
    expect(runAb(clone, ["main-up", "fast"], {}, { D56_BASE_DIR: base }).stderr).toContain('main-up needs build or reuse ("sin referencia")');
    const pr = runAb(clone, ["k6", "pr-1"], {}, { D56_BASE_DIR: base });
    expect(pr.status).toBe(1);
    expect(pr.stderr).toContain('k6 runs main-1, main-2 or their warm-ups only ("sin referencia")');
    expect(runAb(clone, ["tree"], {}, { D56_BASE_DIR: base }).status).toBe(0);
    expect(git(base, "rev-parse", "HEAD")).toBe(mainSha);
    const again = runAb(clone, ["tree"], {}, { D56_BASE_DIR: base });
    expect(again.status).toBe(1);
    expect(again.stderr).toContain(`${base} already exists`);
  });

  it("down: stops at the first command that fails, and fails when docker cannot list what is left", () => {
    const { clone } = mergeClone(() => {});
    const calls = path.join(tempDir("d56-calls-"), "calls");
    const record = (name: string) => `echo "${name} $*" >> ${calls}`;
    const composeFails = runAb(clone, ["down"], { supabase: record("supabase"), docker: `${record("docker")}\ncase "$1" in compose) exit 1 ;; esac`, curl: "exit 7" });
    expect(composeFails.status).toBe(1);
    expect(composeFails.stderr).toContain('docker compose down failed ("sin referencia")');
    expect(readFileSync(calls, "utf-8")).not.toContain("supabase stop");
    const stopFails = runAb(clone, ["down"], { supabase: "exit 1", docker: "true", curl: "exit 7" });
    expect(stopFails.status).toBe(1);
    expect(stopFails.stderr).toContain('supabase stop --no-backup failed ("sin referencia")');
    for (const [command, what] of [
      ["ps", "docker ps"],
      ["volume", "docker volume ls"],
      ["network", "docker network ls"],
    ]) {
      const listing = runAb(clone, ["down"], { supabase: "true", docker: `case "$1" in ${command}) exit 1 ;; esac`, curl: "exit 7" });
      expect(listing.status, what).toBe(1);
      expect(listing.stderr).toContain(`${what} failed after the stack was stopped ("sin referencia")`);
    }
  });

  it("images: lists each image offline and read-only, and the ratio step reads that listing on a docs-only pull request", () => {
    const { clone } = mergeClone(() => {});
    mkdirSync(path.join(clone, "load/.out"), { recursive: true });
    const calls = path.join(tempDir("d56-calls-"), "calls");
    const inImage = "c".repeat(64);
    const docker = [
      `printf '%s\\n' "$*" >> ${calls}`,
      'case "$*" in',
      `  *scaliahr-web:local*) printf '%s\\n' ${SENTINELS.web} /app/apps/web/package.json --d56-md-- ;;`,
      `  *scaliahr-worker:local*) printf '%s\\n' ${SENTINELS.worker} /app/apps/worker/dist/index.js --d56-md-- "${inImage}  /app/apps/worker/README.md" ;;`,
      "  *) exit 9 ;;",
      "esac",
    ].join("\n");
    const result = runNode(clone, ["images", "pr"], { docker });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("D56-ab: images role=pr web_files=2 worker_files=2 markdown=1");
    const runs = readFileSync(calls, "utf-8").trim().split("\n");
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run).toMatch(/^run --rm --user 0 --network none --read-only --cap-drop ALL --cap-add DAC_READ_SEARCH --security-opt no-new-privileges --entrypoint sh scaliahr-(web|worker):local -c set -e; find \/app -xdev /);
    }
    // The listing as the images step wrote it, read by the ratio step without main's passes.
    const listing = readFileSync(path.join(clone, "load/.out/d56-images-pr.json"));
    const docsOnly = (head: string) => {
      const w = world({ passes: ["pr-1", "pr-2"], diffFiles: ["docs/a.md"], markdown: { "docs/a.md": { head, base: null } }, images: null });
      w.files.set("d56-images-pr.json", listing);
      return runRatio(w, { SCOPE_APPLIES: "false" }).result;
    };
    const passes = docsOnly("d".repeat(64));
    expect(passes.status).toBe(0);
    expect(passes.stdout).toContain("scope=not-applicable event=pull_request");
    const fails = docsOnly(inImage);
    expect(fails.status).toBe(1);
    expect(fails.stderr).toContain(`docs/a.md is in an image, and main's passes were skipped ("${VERDICTS.docsOnlyWrong}")`);
    // A listing without the file every image has is not a full one.
    const partial = runNode(clone, ["images", "pr"], { docker: "printf '%s\\n' /app/x --d56-md--" });
    expect(partial.status).toBe(1);
    expect(partial.stderr).toContain(`the image listing lacks ${SENTINELS.web}: it is not a full listing`);
  });

  // record as the PR's step and d56-ab.sh call it: the tree recorded, the pass's own files in load/.out.
  const recordWorld = (changePr: (dir: string) => void = () => {}) => {
    const { clone, prHead } = mergeClone(changePr);
    expect(runAb(clone, ["tree"], {}, { PR_HEAD: prHead, D56_BASE_DIR: path.join(tempDir("d56-base-"), "ScaliaHR") }).status).toBe(0);
    const out = path.join(clone, "load/.out");
    const put = (name: string, opts: PassOptions = {}) => {
      const warm = WARMUPS[name as keyof typeof WARMUPS];
      const spec = warm ?? PASSES[name as keyof typeof PASSES];
      const start = warm ? START[warm.of] - 120_000 : START[name];
      writeFileSync(path.join(out, spec.summary), JSON.stringify(summaryOf({ start, ...opts })));
      writeFileSync(path.join(out, spec.csv), csvOf({ start, ...opts }));
    };
    const imagesOf = (image: { web: string; worker: string }, tag: string) =>
      [
        'case "$*" in',
        `  "inspect -f {{.Image}} scaliahr-web-1"|"image inspect -f {{.Id}} scaliahr-web:${tag}") echo ${image.web} ;;`,
        `  "inspect -f {{.Image}} scaliahr-worker-1"|"image inspect -f {{.Id}} scaliahr-worker:${tag}") echo ${image.worker} ;;`,
        '  "image inspect -f {{index .Config.Labels "*) git describe --always --dirty --abbrev=12 ;;',
        '  *) echo "unexpected docker $*" >&2; exit 9 ;;',
        "esac",
      ].join("\n");
    const record = (name: string, exit: string, docker: string) => runNode(clone, ["record", name, exit], { docker }, { ...PARAMS, GITHUB_RUN_ATTEMPT: "1" });
    return { out, put, imagesOf, record };
  };

  it("record: records the PR's passes from their own files and the :local images, and a broken one as the PR's", () => {
    const { out, put, imagesOf, record } = recordWorld();
    put("pr-1");
    put("pr-2");
    const docker = imagesOf(PR_IMAGE, "local");
    const first = record("pr-1", "0", docker);
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/^D56-ab: pass pass=pr-1 role=pr stack=after_e2e p95_steady_ms=60\.00 samples=600 k6_exit=0 /m);
    expect(JSON.parse(readFileSync(path.join(out, "d56-pass-pr-1.json"), "utf-8"))).toMatchObject({
      pass: "pr-1",
      summary: "summary.json",
      csv: "requests-first.csv.gz",
      web_image: PR_IMAGE.web,
      expected_web: PR_IMAGE.web,
      worker_image: PR_IMAGE.worker,
      params: PARAMS,
    });
    const second = record("pr-2", "99", docker);
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(/^D56-ab: pass pass=pr-2 role=pr stack=after_pass .* k6_exit=99 /m);
    const broken = record("pr-1", "d36-step-failure", docker);
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain(`pr-1: k6 exited "d36-step-failure"; its output is in the D56 artifact ("${VERDICTS.prInvalid}")`);
  });

  it("record: a main pass without its files, with a summary that is not JSON, or whose images cannot be read is \"sin referencia\", and the harness's when the PR changed it", () => {
    const { out, put, imagesOf, record } = recordWorld();
    const docker = imagesOf(MAIN_IMAGE, "base");
    const noSummary = record("main-1", "0", docker);
    expect(noSummary.status).toBe(1);
    expect(noSummary.stderr).toContain(`main-1: k6 left no summary-main-1.json ("${VERDICTS.noReference}")`);
    put("main-1");
    writeFileSync(path.join(out, "summary-main-1.json"), "{ not json");
    expect(record("main-1", "0", docker).stderr).toContain(`main-1: summary-main-1.json is not JSON ("${VERDICTS.noReference}")`);
    put("main-1");
    const blind = record("main-1", "0", 'echo "Cannot connect to the Docker daemon" >&2; exit 1');
    expect(blind.status).toBe(1);
    expect(blind.stderr).toContain(`main-1: cannot read the measured images: Cannot connect to the Docker daemon ("${VERDICTS.noReference}")`);
    // main-1 is recorded only after its warm-up; a warm-up whose summary has no steady-state p95 is broken.
    expect(record("main-1", "0", docker).stderr).toContain(`main-1: its warm-up warm-main-1 was not recorded ("${VERDICTS.noReference}")`);
    writeFileSync(path.join(out, "summary-warm-main-1.json"), JSON.stringify({ metrics: {} }));
    writeFileSync(path.join(out, "requests-warm-main-1.csv.gz"), csvOf({ start: START["main-1"] - 120_000 }));
    expect(record("warm-main-1", "0", docker).stderr).toContain(`warm-main-1: summary-warm-main-1.json has no steady-state p95 ("${VERDICTS.noReference}")`);
    put("warm-main-1", { p95: 70, isolationFails: 1 });
    expect(record("warm-main-1", "0", docker).stderr).toContain(`warm-main-1: 1 page(s) showed another tenant's employees ("${VERDICTS.mainIsolation}")`);
    expect(existsSync(path.join(out, "d56-pass-warm-main-1.json"))).toBe(false);
    const noCount = summaryOf({ p95: 70, start: START["main-1"] - 120_000 }) as { root_group: { checks: Record<string, unknown> } };
    delete noCount.root_group.checks[ISOLATION_CHECK];
    writeFileSync(path.join(out, "summary-warm-main-1.json"), JSON.stringify(noCount));
    expect(record("warm-main-1", "0", docker).stderr).toContain(`warm-main-1: the summary has no tenant-isolation count ("${VERDICTS.noReference}")`);
    put("warm-main-1", { p95: 70 });
    const warm = record("warm-main-1", "99", docker);
    expect(warm.status).toBe(0);
    expect(warm.stdout).toMatch(/^D56-ab: warm pass=warm-main-1 of=main-1 measured=no p95_steady_ms=70\.00 k6_exit=99 /m);
    expect(JSON.parse(readFileSync(path.join(out, "d56-pass-warm-main-1.json"), "utf-8"))).toMatchObject({ isolation_fails: 0, k6_exit: "99" });
    expect(record("main-1", "0", docker).status).toBe(0);

    const harness = recordWorld((dir) => writeFileSync(path.join(dir, "load/pages.js"), "// changed harness\n"));
    const changed = harness.record("main-1", "0", harness.imagesOf(MAIN_IMAGE, "base"));
    expect(changed.status).toBe(1);
    expect(changed.stderr).toContain(`main-1: k6 left no summary-main-1.json ("${VERDICTS.harness}")`);
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

  it("k6: runs the PR's harness with its own files, keeps k6's output out of the log, and records the warm-up and then the pass", () => {
    const { clone, prHead } = mergeClone(() => {});
    const base = path.join(tempDir("d56-base-"), "ScaliaHR");
    expect(runAb(clone, ["tree"], {}, { PR_HEAD: prHead, D56_BASE_DIR: base }).status).toBe(0);
    const out = path.join(clone, "load/.out");
    const fixture = tempDir("d56-fixture-");
    writeFileSync(path.join(fixture, "summary-main-1.json"), JSON.stringify(summaryOf({})));
    writeFileSync(path.join(fixture, "requests-main-1.csv.gz"), csvOf({}));
    // The warm-up runs 2 min before main-1, the same way, to its own files.
    writeFileSync(path.join(fixture, "summary-warm-main-1.json"), JSON.stringify(summaryOf({ p95: 70, start: START["main-1"] - 120_000 })));
    writeFileSync(path.join(fixture, "requests-warm-main-1.csv.gz"), csvOf({ p95: 70, start: START["main-1"] - 120_000 }));
    const npm = [
      'case "$LOAD_SUMMARY" in summary-main-1.json) p=main-1 ;; summary-warm-main-1.json) p=warm-main-1 ;; *) exit 8 ;; esac',
      '[ "$*" = "run load:test -- --out csv=fileName=/out/requests-$p.csv.gz,timeFormat=unix_milli" ] || { echo "unexpected npm $*" >&2; exit 9; }',
      `cp ${fixture}/summary-$p.json ${out}/summary-$p.json`,
      `cp ${fixture}/requests-$p.csv.gz ${out}/requests-$p.csv.gz`,
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
    const env = { ...PARAMS, GITHUB_RUN_ATTEMPT: "1", D56_BASE_DIR: base };
    // main-1 without its warm-up is not measured: the step fails before main-2 is spent.
    const unwarmed = runAb(clone, ["k6", "main-1"], { npm, docker }, env);
    expect(unwarmed.status).toBe(1);
    expect(unwarmed.stderr).toContain(`::error::D56: main-1: its warm-up warm-main-1 was not recorded ("${VERDICTS.noReference}")`);
    const warm = runAb(clone, ["k6", "warm-main-1"], { npm, docker }, env);
    expect(warm.stderr).toBe("");
    expect(warm.status).toBe(0);
    expect(warm.stdout).not.toMatch(/phase:steady|p\(95\)/);
    expect(warm.stdout).toMatch(/^D56-ab: warm pass=warm-main-1 of=main-1 measured=no p95_steady_ms=70\.00 k6_exit=0 /m);
    expect(readFileSync(path.join(out, "k6-warm-main-1.txt"), "utf-8")).toContain("{ kind:page,phase:steady }");
    expect(JSON.parse(readFileSync(path.join(out, "d56-pass-warm-main-1.json"), "utf-8"))).toMatchObject({
      pass: "warm-main-1",
      role: "warm",
      of: "main-1",
      summary: "summary-warm-main-1.json",
      csv: "requests-warm-main-1.csv.gz",
      p95: 70,
      first_request: START["main-1"] - 120_000,
      params: PARAMS,
    });
    const result = runAb(clone, ["k6", "main-1"], { npm, docker }, env);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/phase:steady|p\(95\)/);
    expect(result.stdout).toMatch(/^D56-ab: pass pass=main-1 role=main stack=warmed p95_steady_ms=60\.00 samples=600 k6_exit=0 /m);
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
    const warm = runAb(clone, ["k6", "warm-main-2"], { npm, docker: "exit 9" }, { ...PARAMS, GITHUB_RUN_ATTEMPT: "1", D56_BASE_DIR: base });
    expect(warm.status).toBe(1);
    expect(warm.stderr).toContain("  ERRO[0001] setup failed");
    expect(warm.stderr).not.toMatch(/phase:steady|p\(95\)/);
    expect(warm.stderr).toContain('::error::D56: warm-main-2: k6 exited "107"; its output is in the D56 artifact ("sin referencia")');
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
    // Every path is one of D56's own files: a new entry must be added here, on purpose.
    const paths = step.split("\n").filter((line) => /^ {12}load\//.test(line)).map((line) => line.trim());
    expect(paths).toHaveLength(24);
    for (const file of paths) {
      expect(file).toMatch(/^load\/\.out\/(d56-(tree|ratio|pass-(main|pr|warm-main)-[12]|images-(pr|main))\.json|d56-diff\.bin|summary-(warm-)?main-[12]\.json|requests-(warm-)?main-[12]\.csv\.gz|k6-(warm-)?main-[12]\.txt|k6-exit-second\.txt)$/);
    }
    expect(readFileSync(path.join(REPO, ".gitignore"), "utf-8")).toMatch(/^load\/\.out\/$/m);
  });

  it("the scope script writes its verdict for later steps", () => {
    const work = tempDir("d56-scope-");
    const output = path.join(work, "output");
    for (const [input, applies] of [
      ["docs/a.md\0", "false"],
      ["apps/web/src/a.ts\0", "true"],
    ]) {
      writeFileSync(output, "");
      const result = spawnSync(process.execPath, [path.join(REPO, "scripts/k6-comparison-scope.mjs")], { input, encoding: "utf-8", env: cleanEnv({ GITHUB_OUTPUT: output }) });
      expect(result.status).toBe(0);
      expect(readFileSync(output, "utf-8")).toBe(`applies=${applies}\n`);
    }
  });
});
