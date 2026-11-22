// D56: the D36 k6 gate as an A/B comparison with main on the same runner.
// The docker job runs four k6 passes in the order main, PR, PR, main (ABBA),
// all with the PR's harness (load/**, scripts/load-test.sh) and the same load
// settings, and compares
//   r = exp(mean(ln p95 of the PR's passes) − mean(ln p95 of main's passes))
// with LIMIT. Every command prints "D56-ab:" lines in the log and the job
// summary; none prints a `kind:page,phase:steady` or p(95) line, so the only
// such line in the job's log is still the first PR pass's (D36, D54).
//   node scripts/d56-ab.mjs tree <worktree> <diff-file>
//   node scripts/d56-ab.mjs record <pass> <k6 exit code>
//   node scripts/d56-ab.mjs images <main|pr>
//   node scripts/d56-ab.mjs ratio
// A command that cannot do its job exits 1 with a "::error::" annotation, which
// names the verdict for every failure it checks for; it never prints a guessed
// value and never passes open.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ISOLATION_CHECK, K6_THRESHOLDS_CROSSED, cpuModel, escapeCommand, firstRequestMs, formatValue, outputTail, pageSteadyStats, readCsvRows } from "./d36-diag.mjs";
import { comparisonScope, parsePaths } from "./k6-comparison-scope.mjs";

export const PREFIX = "D56-ab: ";
/** r above this fails the first attempt, which allows one re-run; the pull request is blocked when the re-run is above it too. */
export const LIMIT = 1.2;
/** About 940 steady-state page samples per pass in CI; fewer than this is a broken run, not a measurement. */
export const MIN_STEADY_PAGES = 500;
export const OUT = "load/.out";
export const ORDER = Object.freeze(["main-1", "pr-1", "pr-2", "main-2"]);
/** Each pass's own files in load/.out, and the state of its stack when k6 starts. */
export const PASSES = Object.freeze({
  "main-1": { role: "main", summary: "summary-main-1.json", csv: "requests-main-1.csv.gz", output: "k6-main-1.txt", stack: "warmed" },
  "pr-1": { role: "pr", summary: "summary.json", csv: "requests-first.csv.gz", output: "", stack: "warmed" },
  "pr-2": { role: "pr", summary: "summary-second.json", csv: "requests-second.csv.gz", output: "second-pass.txt", stack: "after_pass" },
  "main-2": { role: "main", summary: "summary-main-2.json", csv: "requests-main-2.csv.gz", output: "k6-main-2.txt", stack: "warmed" },
});
/**
 * The unmeasured k6 pass that warms a stack right before a measured pass:
 * before each of main's passes (2026-11-21) and before pr-1, after the e2e
 * (2026-11-22). So every measured pass starts on a stack that a k6 pass has
 * just served (pr-2 follows pr-1). Its own files; its p95 is informational and
 * never reaches the log as a `kind:page,phase:steady` line.
 */
export const WARMUPS = Object.freeze({
  "warm-main-1": { of: "main-1", summary: "summary-warm-main-1.json", csv: "requests-warm-main-1.csv.gz", output: "k6-warm-main-1.txt" },
  "warm-pr-1": { of: "pr-1", summary: "summary-warm-pr-1.json", csv: "requests-warm-pr-1.csv.gz", output: "k6-warm-pr-1.txt" },
  "warm-main-2": { of: "main-2", summary: "summary-warm-main-2.json", csv: "requests-warm-main-2.csv.gz", output: "k6-warm-main-2.txt" },
});
export const WARMUP_OF = Object.freeze({ "main-1": "warm-main-1", "pr-1": "warm-pr-1", "main-2": "warm-main-2" });

/** The verdict of a missing or broken warm-up: the PR's own, or that of a broken main pass. */
export function brokenWarmupVerdict(role, harnessChanged) {
  return role === "pr" ? VERDICTS.prWarmBroken : brokenRunVerdict("main", harnessChanged);
}
/** The verdict of a page with another tenant's employees, on the side the pass is on. */
const isolationVerdict = (role) => (role === "main" ? VERDICTS.mainIsolation : VERDICTS.prIsolation);
/** The load settings of the D36 step; every pass must run with the same ones. */
export const LOAD_PARAMS = Object.freeze(["LOAD_BIG_USERS", "LOAD_SMALL_USERS", "LOAD_VUS", "SMALL_VUS", "RAMP", "HOLD", "THINK_MIN", "THINK_MAX"]);
export const IMAGES = Object.freeze({
  main: { web: "scaliahr-web:base", worker: "scaliahr-worker:base" },
  pr: { web: "scaliahr-web:local", worker: "scaliahr-worker:local" },
});
/** A file that always exists in each image, so an empty or failed listing is never read as "no Markdown". */
export const SENTINELS = Object.freeze({ web: "/app/apps/web/server.js", worker: "/app/apps/worker/package.json" });
/** The thresholds of load/pages.js that say whether the run itself was correct. Only the 500 ms ceiling may be crossed: it is the measurement. */
export const CORRECTNESS_THRESHOLDS = Object.freeze(["checks", `checks{check:${ISOLATION_CHECK}}`, "http_req_failed{kind:page}"]);
export const CEILING = "http_req_duration{kind:page,phase:steady}";
const SAME_MS = 0.001;
const SHA1 = /^[0-9a-f]{40}$/;
const KEY = /^[a-z][a-z0-9_]*$/;

/** The verdicts a failure can carry, with the label the PR's verification table uses. */
export const VERDICTS = Object.freeze({
  noReference: "sin referencia",
  harness: "arnés del PR incompatible con main",
  mainIsolation: "main falla aislamiento",
  prIsolation: "el PR falla aislamiento",
  prInvalid: "pasada del PR inválida",
  prWarmBroken: "calentamiento del PR roto",
  mismatch: "pasadas no comparables",
  docsOnlyWrong: "solo docs mal clasificado",
  overFirst: "sobre el límite en el intento 1",
  overSecond: "sobre el límite en el intento 2",
  cap: "tope de una repetición",
  mergedRegression: "regresión ya mergeada",
});

export class GateError extends Error {
  constructor(verdict, message) {
    super(message);
    this.verdict = verdict;
  }
}

/** "D56-ab: <topic> key=value …", the D36-diag grammar with its own prefix. */
export function abLine(topic, fields) {
  if (!/^[a-z][a-z ]*$/.test(topic)) throw new Error(`bad topic "${topic}"`);
  const entries = Object.entries(fields);
  if (entries.length === 0) throw new Error(`no fields for "${topic}"`);
  const bad = entries.find(([key]) => !KEY.test(key));
  if (bad) throw new Error(`bad key "${bad[0]}"`);
  const line = `${PREFIX}${[topic, ...entries.map(([key, value]) => `${key}=${formatValue(value)}`)].join(" ")}`;
  if (line.includes("kind:page,phase:steady") || line.includes("p(95)")) throw new Error("a D56-ab line never carries a k6 p95 line");
  return line;
}

export function emit(line) {
  console.log(line);
  const fence = line.includes("`") ? "``" : "`";
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${fence} ${line} ${fence}\n\n`);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** True for the PR's harness: what the main passes run with, not main's own. */
export const isHarness = (file) => file.startsWith("load/") || file === "scripts/load-test.sh";

// 1. The tree

/**
 * What the ratio needs from git, written once: both SHAs and revisions, the
 * diff (its sha256 and count, so a missing or other diff never reads as empty),
 * whether it touches the harness, and the content hash of every Markdown file
 * it touches (in HEAD and in HEAD^1), to find it in an image by content.
 */
export function treeRecord({ worktree, worktreeHead, baseSha, headSha, baseRevision, headRevision, diff, blob }) {
  for (const [name, sha] of [["HEAD^1", baseSha], ["HEAD", headSha], ["the worktree's HEAD", worktreeHead]]) {
    if (!SHA1.test(sha ?? "")) throw new GateError(VERDICTS.noReference, `${name} is not a commit SHA: "${sha}"`);
  }
  if (worktreeHead !== baseSha) throw new GateError(VERDICTS.noReference, `main's worktree is at ${worktreeHead}, not at HEAD^1 ${baseSha}`);
  if (baseSha === headSha) throw new GateError(VERDICTS.noReference, "HEAD^1 and HEAD are the same commit");
  // The same `git describe --always --dirty --abbrev=12` local-up.sh puts on the image; a dirty tree is not the commit.
  for (const [name, revision] of [["main's", baseRevision], ["the PR's", headRevision]]) {
    if (!/^[0-9A-Za-z][\w.-]*$/.test(revision ?? "") || revision.endsWith("-dirty")) {
      throw new GateError(VERDICTS.noReference, `${name} revision "${revision}" is not a clean describe of the commit`);
    }
  }
  const files = parsePaths(diff.toString("utf-8"));
  const markdown = {};
  for (const file of files.filter((f) => f.endsWith(".md"))) markdown[file] = { head: blob(headSha, file), base: blob(baseSha, file) };
  return {
    worktree,
    base_sha: baseSha,
    head_sha: headSha,
    base_revision: baseRevision,
    head_revision: headRevision,
    diff_sha256: sha256(diff),
    diff_files: files.length,
    harness_changed: files.some(isHarness),
    markdown,
  };
}

// 2. One pass

/** The pass's k6 exit code: 0, or 99 when a threshold was crossed. */
export function passExit(exitCode) {
  const code = /^\d+$/.test(String(exitCode)) ? Number(exitCode) : NaN;
  return code === 0 || code === K6_THRESHOLDS_CROSSED ? code : null;
}

/** The verdict of a pass that did not run: main's is "no reference", or the PR's harness when the PR changed it. */
export function brokenRunVerdict(role, harnessChanged) {
  if (role === "pr") return VERDICTS.prInvalid;
  return harnessChanged ? VERDICTS.harness : VERDICTS.noReference;
}

export function loadParams(env) {
  const params = {};
  for (const key of LOAD_PARAMS) {
    const value = env[key];
    if (typeof value !== "string" || value.trim() === "") throw new Error(`the load setting ${key} is not set`);
    params[key] = value;
  }
  return params;
}

/**
 * Checks one pass against its record, summary and CSV. Returns its p95, sample
 * count and first request time; throws a GateError with the pass's verdict.
 */
export function validatePass(name, record, summary, rows, tree) {
  const spec = PASSES[name];
  if (!spec) throw new Error(`unknown pass "${name}"`);
  const broken = (message) => new GateError(brokenRunVerdict(spec.role, tree.harness_changed), `${name}: ${message}`);
  if (record?.pass !== name || record.role !== spec.role) throw broken("its record is not this pass's");
  if (record.summary !== spec.summary || record.csv !== spec.csv) throw broken(`its summary or CSV is not its own (${spec.summary}, ${spec.csv})`);
  if (passExit(record.k6_exit) === null) throw broken(`k6 exited ${JSON.stringify(record.k6_exit)}`);
  if (name === "pr-1" && Number(record.k6_exit) !== 0) throw broken("the D36 step did not pass");
  for (const key of ["web_image", "worker_image", "expected_web", "expected_worker"]) {
    if (!/^sha256:[0-9a-f]{64}$/.test(record[key] ?? "")) throw broken(`its ${key} ${JSON.stringify(record[key] ?? null)} is not an image id`);
  }

  const metrics = summary?.metrics ?? {};
  const isolation = summary?.root_group?.checks?.[ISOLATION_CHECK];
  if (typeof isolation?.fails !== "number" || !Number.isInteger(isolation.fails) || isolation.fails < 0) {
    throw broken("the summary has no tenant-isolation count");
  }
  if (isolation.fails > 0) {
    throw new GateError(spec.role === "main" ? VERDICTS.mainIsolation : VERDICTS.prIsolation, `${name}: ${isolation.fails} page(s) showed another tenant's employees`);
  }
  const isolationFlag = metrics[`checks{check:${ISOLATION_CHECK}}`]?.thresholds?.["rate==1"];
  if (isolationFlag !== false) throw broken(`the isolation threshold says ${JSON.stringify(isolationFlag)}, but no page leaked: a summary in an unknown format`);
  for (const key of CORRECTNESS_THRESHOLDS) {
    const flags = metrics[key]?.thresholds;
    if (!flags || Object.keys(flags).length === 0) throw broken(`the summary has no threshold on ${key}`);
    for (const [expression, crossed] of Object.entries(flags)) {
      if (typeof crossed !== "boolean") throw broken(`the threshold ${key} ${expression} has no result`);
      if (crossed) throw broken(`the run's own threshold ${key} ${expression} was crossed`);
    }
  }
  for (const [key, metric] of Object.entries(metrics)) {
    if (key === CEILING) continue;
    for (const [expression, crossed] of Object.entries(metric?.thresholds ?? {})) {
      if (crossed !== false) throw broken(`the threshold ${key} ${expression} was crossed`);
    }
  }
  const p95 = metrics[CEILING]?.["p(95)"];
  if (!(typeof p95 === "number" && Number.isFinite(p95) && p95 > 0)) throw broken("the summary has no steady-state page p95 above 0");
  const vus = Number(record.params?.LOAD_VUS) + 3 * Number(record.params?.SMALL_VUS);
  if (metrics.vus_max?.value !== vus) throw broken(`vus_max is ${metrics.vus_max?.value}, not LOAD_VUS + 3 × SMALL_VUS = ${vus}`);

  let stats;
  try {
    stats = pageSteadyStats(rows);
  } catch (error) {
    throw broken(error.message);
  }
  if (stats.count < MIN_STEADY_PAGES) throw broken(`${stats.count} steady-state page samples, fewer than ${MIN_STEADY_PAGES}`);
  if (!(Math.abs(stats.p95 - p95) <= SAME_MS)) throw broken(`its CSV's steady p95 (${stats.p95}) is not its summary's (${p95})`);
  return { p95, samples: stats.count, firstRequest: firstRequestMs(rows) };
}

/** The pass's line: what was measured, on which image and CPU, with which harness and settings. */
export function passLine(name, record, measured) {
  return abLine("pass", {
    pass: name,
    role: record.role,
    stack: PASSES[name].stack,
    p95_steady_ms: measured.p95.toFixed(2),
    samples: measured.samples,
    k6_exit: Number(record.k6_exit),
    web_image: record.web_image,
    revision: record.revision,
    cpu: record.cpu,
    harness: record.harness,
    params: LOAD_PARAMS.map((key) => `${key}=${record.params[key]}`).join(","),
    attempt: record.run_attempt,
  });
}

/** The informational line of a warm-up: never a measured pass, never a `kind:page,phase:steady` line. */
export function warmLine(name, record) {
  return abLine("warm", {
    pass: name,
    of: record.of,
    measured: "no",
    p95_steady_ms: record.p95.toFixed(2),
    k6_exit: Number(record.k6_exit),
    web_image: record.web_image,
    cpu: record.cpu,
    attempt: record.run_attempt,
  });
}

/**
 * Checks the warm-up of a measured pass against that pass: recorded, k6
 * exited 0 or 99, a p95, a tenant-isolation count of 0, the same settings,
 * harness, attempt and images, and run right before the pass (after
 * `previousFirstRequest`, the pass before it, when there is one: `record`
 * passes null, and the ratio step checks that order).
 * - A missing or broken warm-up of main's leaves its pass without a reference;
 *   the PR's is "calentamiento del PR roto".
 * - A leak is the isolation failure of the side the pass is on.
 * - One that differs makes the passes not comparable.
 */
export function checkWarmup(mainName, warm, mainRecord, mainFirstRequest, previousFirstRequest, tree) {
  const name = WARMUP_OF[mainName];
  if (!name) throw new Error(`${mainName} has no warm-up`);
  const role = PASSES[mainName].role;
  const broken = (message) => new GateError(brokenWarmupVerdict(role, tree.harness_changed), `${mainName}: its warm-up ${name} ${message}`);
  const differs = (message) => new GateError(VERDICTS.mismatch, `${name} ${message}`);
  if (!warm) throw broken("was not recorded");
  if (warm.pass !== name || warm.of !== mainName || warm.role !== "warm") throw broken("has a record that is not its own");
  if (passExit(warm.k6_exit) === null) throw broken(`ran, but k6 exited ${JSON.stringify(warm.k6_exit)}`);
  if (!(Number.isInteger(warm.isolation_fails) && warm.isolation_fails >= 0)) throw broken("left no tenant-isolation count");
  if (warm.isolation_fails > 0) throw new GateError(isolationVerdict(role), `${name}: ${warm.isolation_fails} page(s) showed another tenant's employees`);
  if (!(Number.isFinite(warm.p95) && warm.p95 > 0)) throw broken("left no steady-state p95");
  if (!Number.isFinite(warm.first_request)) throw broken("left no first request time");
  for (const key of LOAD_PARAMS) {
    if (warm.params?.[key] !== mainRecord.params[key]) throw differs(`ran with ${key}=${warm.params?.[key]}, ${mainName} with ${mainRecord.params[key]}`);
  }
  if (warm.harness !== mainRecord.harness) throw differs(`ran another harness than ${mainName}`);
  if (String(warm.run_attempt) !== String(mainRecord.run_attempt)) throw differs(`was recorded in attempt ${warm.run_attempt}, ${mainName} in attempt ${mainRecord.run_attempt}`);
  if (warm.web_image !== mainRecord.web_image || warm.worker_image !== mainRecord.worker_image) throw differs(`warmed other images than ${mainName} measured`);
  if (!(warm.first_request < mainFirstRequest) || (previousFirstRequest !== null && !(warm.first_request > previousFirstRequest))) {
    throw differs(`did not run right before ${mainName}`);
  }
}

// 3. The images, for the docs-only rule

/** The files under /app (node_modules and .next left out) and the sha256 of each Markdown file, from `find` and `sha256sum`. */
export function parseListing(text, sentinel) {
  const [filesPart, mdPart] = text.split("\n--d56-md--\n");
  if (mdPart === undefined) throw new Error("the image listing has no Markdown section");
  const files = filesPart.split("\n").filter(Boolean);
  if (!files.includes(sentinel)) throw new Error(`the image listing lacks ${sentinel}: it is not a full listing`);
  const md = {};
  for (const line of mdPart.split("\n").filter(Boolean)) {
    const match = /^([0-9a-f]{64}) {2}(\/app\/.+)$/.exec(line);
    if (!match) throw new Error(`not a sha256sum line: ${JSON.stringify(line)}`);
    md[match[2]] = match[1];
  }
  return { files, md };
}

/** The diff's files that are in an image: by their path under /app, or, for Markdown, by content. */
export function filesInImages(tree, listings) {
  const found = [];
  const diffFiles = Object.keys(tree.markdown ?? {});
  for (const listing of listings) {
    for (const file of tree.files ?? []) if (listing.files.includes(`/app/${file}`)) found.push(file);
    const hashes = new Set(Object.values(listing.md));
    for (const file of diffFiles) {
      const { head, base } = tree.markdown[file];
      if ((head && hashes.has(head)) || (base && hashes.has(base))) found.push(file);
    }
  }
  return [...new Set(found)].sort();
}

// 4. The ratio

/** r = exp(mean ln PR − mean ln main). */
export function ratio(mainP95s, prP95s) {
  const meanLn = (values) => values.reduce((sum, v) => sum + Math.log(v), 0) / values.length;
  return Math.exp(meanLn(prP95s) - meanLn(mainP95s));
}

/** r as the verdicts print it: four decimals, or what it is when it is not a number. */
const shownR = (r) => (Number.isFinite(r) ? r.toFixed(4) : String(r));

/**
 * The verdict. On a pull request, r above LIMIT fails the first attempt and
 * allows one re-run; the pull request is blocked when the re-run is above LIMIT
 * too, and a third attempt never passes. A push to main does not re-run: r
 * above LIMIT fails it as a regression already merged. Without a change in the
 * images (docs only) nothing blocks.
 */
export function verdict({ event, applies, r, attempt }) {
  if (!applies) return { pass: true, verdict: "not applicable (no changes in the images)" };
  if (event === "push") {
    if (Number.isFinite(r) && r <= LIMIT) return { pass: true, verdict: "within the limit" };
    return { pass: false, label: VERDICTS.mergedRegression, verdict: `r ${shownR(r)} is above ${LIMIT} on main: a regression already merged` };
  }
  if (attempt >= 3) return { pass: false, label: VERDICTS.cap, verdict: `attempt ${attempt}: only one re-run counts` };
  if (Number.isFinite(r) && r <= LIMIT) return { pass: true, verdict: "within the limit" };
  if (attempt === 1) return { pass: false, label: VERDICTS.overFirst, verdict: `r ${shownR(r)} is above ${LIMIT} on the first attempt: one re-run of the docker job is allowed` };
  return { pass: false, label: VERDICTS.overSecond, verdict: `r ${shownR(r)} is above ${LIMIT} on the re-run as well: the pull request is blocked` };
}

/** GITHUB_RUN_ATTEMPT as a number, or an error: an unset attempt must not skip the cap. */
export function runAttempt(value) {
  if (!/^[1-9]\d*$/.test(value ?? "")) throw new Error(`GITHUB_RUN_ATTEMPT "${value}" is not an attempt number`);
  return Number(value);
}

/**
 * Everything the ratio step decides, from the files the earlier steps wrote.
 * `read(file)` returns a file's bytes in load/.out or null when it is absent.
 */
export function decide({ event, scopeApplies, attemptValue, read }) {
  const attempt = runAttempt(attemptValue);
  const json = (file) => {
    const bytes = read(file);
    if (bytes === null) return null;
    try {
      return JSON.parse(bytes.toString("utf-8"));
    } catch {
      throw new GateError(VERDICTS.mismatch, `${file} is not JSON`);
    }
  };
  const tree = json("d56-tree.json");
  if (!tree) throw new GateError(VERDICTS.noReference, "d56-tree.json is missing: the tree step did not run");
  const diff = read("d56-diff.bin");
  if (diff === null || sha256(diff) !== tree.diff_sha256) throw new GateError(VERDICTS.mismatch, "d56-diff.bin is missing or is not the diff the tree step recorded");
  const files = parsePaths(diff.toString("utf-8"));
  if (files.length !== tree.diff_files) throw new GateError(VERDICTS.mismatch, "the diff's file count is not the recorded one");
  tree.files = files;

  let staticApplies;
  if (event === "pull_request") {
    if (scopeApplies !== "true" && scopeApplies !== "false") throw new GateError(VERDICTS.mismatch, `the scope step left no verdict ("${scopeApplies}")`);
    staticApplies = scopeApplies === "true";
    if (comparisonScope(files).applies !== staticApplies) throw new GateError(VERDICTS.mismatch, "the scope step's verdict is not the one for this diff");
  } else if (event === "push") {
    if (scopeApplies) throw new GateError(VERDICTS.mismatch, "a push has no scope step, yet a scope verdict was passed");
    staticApplies = comparisonScope(files).applies;
  } else {
    throw new GateError(VERDICTS.mismatch, `unknown event "${event}"`);
  }

  /** @type {Record<string, any>} Each recorded pass: its record, what it measured and its summary's hash. */
  const passes = {};
  for (const name of ORDER) {
    const record = json(`d56-pass-${name}.json`);
    if (!record) continue;
    const summary = json(PASSES[name].summary);
    const csv = read(PASSES[name].csv);
    if (!summary || csv === null) throw new GateError(brokenRunVerdict(PASSES[name].role, tree.harness_changed), `${name}: its summary or CSV is missing`);
    let rows;
    try {
      rows = readCsvRows(csv);
    } catch (error) {
      throw new GateError(brokenRunVerdict(PASSES[name].role, tree.harness_changed), `${name}: ${error.message}`);
    }
    passes[name] = { record, measured: validatePass(name, record, summary, rows, tree), summarySha: sha256(read(PASSES[name].summary)) };
  }
  for (const name of ["pr-1", "pr-2"]) if (!passes[name]) throw new GateError(VERDICTS.prInvalid, `${name} was not recorded`);
  const mainPresent = ["main-1", "main-2"].filter((name) => passes[name]);

  // Docs only: a changed file that is in an image (by path, or Markdown by content) makes the change count.
  let applies = staticApplies;
  if (!staticApplies) {
    const listings = [];
    for (const role of event === "push" ? ["pr", "main"] : ["pr"]) {
      const images = json(`d56-images-${role}.json`);
      if (!images) throw new GateError(VERDICTS.docsOnlyWrong, `the ${role} images were not listed, so a docs-only diff cannot be confirmed`);
      for (const kind of ["web", "worker"]) {
        if (!images[kind]?.files || !images[kind]?.md) throw new GateError(VERDICTS.docsOnlyWrong, `the ${role} ${kind} image listing is incomplete`);
        listings.push(images[kind]);
      }
    }
    const inImages = filesInImages(tree, listings);
    if (inImages.length > 0) {
      if (event === "pull_request") throw new GateError(VERDICTS.docsOnlyWrong, `the diff is docs-only for D36, but ${inImages.join(", ")} is in an image, and main's passes were skipped`);
      applies = true;
    }
  }
  if ((applies || event === "push") && mainPresent.length !== 2) {
    throw new GateError(VERDICTS.noReference, `main's passes are missing (${["main-1", "main-2"].filter((n) => !passes[n]).join(", ")})`);
  }

  // Everything compared must be comparable: same settings, harness and attempt; the right images; the ABBA order.
  const present = ORDER.filter((name) => passes[name]);
  const first = passes[present[0]].record;
  for (const name of present) {
    const { record } = passes[name];
    for (const key of LOAD_PARAMS) {
      if (record.params[key] !== first.params[key]) throw new GateError(VERDICTS.mismatch, `${name} ran with ${key}=${record.params[key]}, ${present[0]} with ${first.params[key]}`);
    }
    if (record.harness !== first.harness) throw new GateError(VERDICTS.mismatch, `${name} ran another harness than ${present[0]}`);
    if (String(record.run_attempt) !== String(attempt)) throw new GateError(VERDICTS.mismatch, `${name} was recorded in attempt ${record.run_attempt}, not in attempt ${attempt}`);
    const expected = record.role === "main" ? tree.base_revision : tree.head_revision;
    if (record.revision !== expected) throw new GateError(VERDICTS.mismatch, `${name} ran revision ${record.revision}, not ${expected}`);
    if (record.web_image !== record.expected_web || record.worker_image !== record.expected_worker) {
      throw new GateError(VERDICTS.mismatch, `${name} measured an image other than ${IMAGES[record.role].web} and ${IMAGES[record.role].worker}`);
    }
  }
  const image = (name) => passes[name]?.record.web_image;
  if (image("pr-1") !== image("pr-2")) throw new GateError(VERDICTS.mismatch, "pr-1 and pr-2 measured different images");
  if (mainPresent.length === 2) {
    if (image("main-1") !== image("main-2")) throw new GateError(VERDICTS.mismatch, "main-1 and main-2 measured different images");
    if (image("main-1") === image("pr-1")) throw new GateError(VERDICTS.mismatch, "main's passes and the PR's measured the same image");
  }
  for (let i = 1; i < present.length; i += 1) {
    if (!(passes[present[i]].measured.firstRequest > passes[present[i - 1]].measured.firstRequest)) {
      throw new GateError(VERDICTS.mismatch, `${present[i]} did not start after ${present[i - 1]}: not the order ${ORDER.join(", ")}`);
    }
  }
  if (new Set(present.map((name) => passes[name].summarySha)).size !== present.length) throw new GateError(VERDICTS.mismatch, "two passes have the same summary");

  // Each measured pass but pr-2 starts on a stack its warm-up has just served (2026-11-21, 2026-11-22).
  /** @type {Record<string, any>} The warm-up record of each pass present that has one. */
  const warmups = {};
  for (const name of ORDER.filter((n) => passes[n] && WARMUP_OF[n])) {
    const previous = ORDER.slice(0, ORDER.indexOf(name)).reverse().find((n) => passes[n]);
    warmups[name] = json(`d56-pass-${WARMUP_OF[name]}.json`);
    checkWarmup(name, warmups[name], passes[name].record, passes[name].measured.firstRequest, previous ? passes[previous].measured.firstRequest : null, tree);
  }

  const r = mainPresent.length === 2 ? ratio([passes["main-1"].measured.p95, passes["main-2"].measured.p95], [passes["pr-1"].measured.p95, passes["pr-2"].measured.p95]) : NaN;
  const decision = verdict({ event, applies, r, attempt });
  return { tree, passes, warmups, applies, r, attempt, event, ...decision };
}

export function ratioLine({ event, applies, r, attempt, verdict: text, passes }) {
  const p95s = (names) => names.filter((n) => passes[n]).map((n) => passes[n].measured.p95.toFixed(2)).join(",") || "none";
  return abLine("ratio", {
    r: Number.isFinite(r) ? r.toFixed(4) : "none",
    limit: LIMIT.toFixed(2),
    main_ms: p95s(["main-1", "main-2"]),
    pr_ms: p95s(["pr-1", "pr-2"]),
    scope: applies ? "applies" : "not-applicable",
    event,
    attempt,
    verdict: text,
  });
}

// CLI

const outPath = (file) => `${OUT}/${file}`;
const readOut = (file) => (existsSync(outPath(file)) ? readFileSync(outPath(file)) : null);
const git = (args) => execFileSync("git", args, { encoding: "utf-8" }).trim();
// An image listing can pass the 1 MiB default; a larger buffer keeps that from failing the step.
const docker = (args) => execFileSync("docker", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();

function harnessHash() {
  const files = git(["ls-files", "-z", "--", "load", "scripts/load-test.sh"]).split("\0").filter(Boolean).sort();
  if (files.length === 0) throw new Error("no harness files (load/**, scripts/load-test.sh)");
  const hash = createHash("sha256");
  for (const file of files) hash.update(`${file}\0`).update(readFileSync(file)).update("\0");
  return hash.digest("hex").slice(0, 12);
}

function lscpuModel() {
  try {
    return cpuModel(execFileSync("lscpu", [], { encoding: "utf-8", env: { ...process.env, LC_ALL: "C" } })) ?? "unavailable";
  } catch {
    return "unavailable";
  }
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "tree": {
      const [worktree, diffFile] = rest;
      if (!worktree || !diffFile) throw new Error("usage: node scripts/d56-ab.mjs tree <worktree> <diff-file>");
      const blob = (rev, file) => {
        try {
          return sha256(execFileSync("git", ["show", `${rev}:${file}`], { stdio: ["ignore", "pipe", "ignore"] }));
        } catch {
          return null; // the file is not in that commit (added or deleted)
        }
      };
      const record = treeRecord({
        worktree,
        worktreeHead: git(["-C", worktree, "rev-parse", "HEAD"]),
        baseSha: git(["rev-parse", "--verify", "HEAD^1"]),
        headSha: git(["rev-parse", "--verify", "HEAD"]),
        baseRevision: git(["-C", worktree, "describe", "--always", "--dirty", "--abbrev=12"]),
        headRevision: git(["describe", "--always", "--dirty", "--abbrev=12"]),
        diff: readFileSync(diffFile),
        blob,
      });
      writeFileSync(outPath("d56-tree.json"), `${JSON.stringify(record, null, 2)}\n`);
      return emit(
        abLine("tree", {
          base_sha: record.base_sha,
          head_sha: record.head_sha,
          base_revision: record.base_revision,
          head_revision: record.head_revision,
          diff_files: record.diff_files,
          harness: record.harness_changed ? "changed" : "same",
        }),
      );
    }
    case "record": {
      const [name, exitCode] = rest;
      const warmup = WARMUPS[name];
      const spec = warmup ? { ...warmup, role: PASSES[warmup.of].role } : PASSES[name];
      if (!spec) throw new Error(`usage: node scripts/d56-ab.mjs record <${[...ORDER, ...Object.keys(WARMUPS)].join("|")}> <k6 exit code>`);
      const tree = JSON.parse(readFileSync(outPath("d56-tree.json"), "utf-8"));
      const params = loadParams(process.env);
      const failed = (message) => new GateError(warmup ? brokenWarmupVerdict(spec.role, tree.harness_changed) : brokenRunVerdict(spec.role, tree.harness_changed), `${name}: ${message}`);
      // A pass that did not run fails here, before the next pass is spent; the ratio checks every pass again.
      if (passExit(exitCode) === null) {
        if (spec.output) console.error(outputTail(readOut(spec.output)?.toString("utf-8") ?? ""));
        throw failed(`k6 exited ${JSON.stringify(exitCode ?? "")}; its output is in the D56 artifact`);
      }
      const summaryBytes = readOut(spec.summary);
      const csv = readOut(spec.csv);
      if (summaryBytes === null || csv === null) throw failed(`k6 left no ${summaryBytes === null ? spec.summary : spec.csv}`);
      let images;
      try {
        const web = docker(["inspect", "-f", "{{.Image}}", "scaliahr-web-1"]);
        images = {
          web_image: web,
          worker_image: docker(["inspect", "-f", "{{.Image}}", "scaliahr-worker-1"]),
          expected_web: docker(["image", "inspect", "-f", "{{.Id}}", IMAGES[spec.role].web]),
          expected_worker: docker(["image", "inspect", "-f", "{{.Id}}", IMAGES[spec.role].worker]),
          revision: docker(["image", "inspect", "-f", '{{index .Config.Labels "org.opencontainers.image.revision"}}', web]),
        };
      } catch (error) {
        throw failed(`cannot read the measured images: ${String(error.stderr || error.message).trim().split("\n")[0]}`);
      }
      const record = {
        pass: name,
        role: warmup ? "warm" : spec.role,
        ...(warmup ? { of: warmup.of } : {}),
        summary: spec.summary,
        csv: spec.csv,
        k6_exit: String(exitCode),
        ...images,
        cpu: lscpuModel(),
        harness: harnessHash(),
        params,
        run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? "",
      };
      if (!warmup) writeFileSync(outPath(`d56-pass-${name}.json`), `${JSON.stringify(record, null, 2)}\n`);
      let summary;
      try {
        summary = JSON.parse(summaryBytes.toString("utf-8"));
      } catch {
        throw failed(`${spec.summary} is not JSON`);
      }
      let rows;
      try {
        rows = readCsvRows(csv);
      } catch (error) {
        throw failed(error.message);
      }
      if (warmup) {
        // Not measured: its record holds what the ratio step checks against its pass, and its p95 for the log.
        // A warm-up is not measured, but a page with another tenant's employees fails it as any pass (D54).
        const isolation = summary?.root_group?.checks?.[ISOLATION_CHECK];
        if (typeof isolation?.fails !== "number" || !Number.isInteger(isolation.fails) || isolation.fails < 0) throw failed("the summary has no tenant-isolation count");
        if (isolation.fails > 0) throw new GateError(isolationVerdict(spec.role), `${name}: ${isolation.fails} page(s) showed another tenant's employees`);
        const p95 = summary?.metrics?.[CEILING]?.["p(95)"];
        if (!(Number.isFinite(p95) && p95 > 0)) throw failed(`${spec.summary} has no steady-state p95`);
        let firstRequest;
        try {
          firstRequest = firstRequestMs(rows);
        } catch (error) {
          throw failed(error.message);
        }
        const warmRecord = { ...record, p95, first_request: firstRequest, isolation_fails: isolation.fails };
        writeFileSync(outPath(`d56-pass-${name}.json`), `${JSON.stringify(warmRecord, null, 2)}\n`);
        return emit(warmLine(name, warmRecord));
      }
      const measured = validatePass(name, record, summary, rows, tree);
      // The warm-up ran just before on this stack; the ratio step checks the order against the pass before too.
      if (WARMUP_OF[name]) {
        const warmFile = `d56-pass-${WARMUP_OF[name]}.json`;
        const warmBytes = readOut(warmFile);
        let warm = null;
        try {
          if (warmBytes !== null) warm = JSON.parse(warmBytes.toString("utf-8"));
        } catch {
          throw failed(`${warmFile} is not JSON`);
        }
        checkWarmup(name, warm, record, measured.firstRequest, null, tree);
      }
      return emit(passLine(name, record, measured));
    }
    case "images": {
      const [role] = rest;
      if (!IMAGES[role]) throw new Error("usage: node scripts/d56-ab.mjs images <main|pr>");
      const listing = {};
      const prune = "\\( -path '*/node_modules' -o -path '*/.next' \\) -prune -o -type f";
      for (const kind of ["web", "worker"]) {
        const text = docker([
          "run", "--rm", "--user", "0", "--network", "none", "--read-only", "--cap-drop", "ALL", "--cap-add", "DAC_READ_SEARCH",
          "--security-opt", "no-new-privileges", "--entrypoint", "sh", IMAGES[role][kind], "-c",
          `set -e; find /app -xdev ${prune} -print; echo --d56-md--; find /app -xdev ${prune} -name '*.md' -exec sha256sum {} +`,
        ]);
        listing[kind] = { image: IMAGES[role][kind], ...parseListing(`${text}\n`, SENTINELS[kind]) };
      }
      writeFileSync(outPath(`d56-images-${role}.json`), `${JSON.stringify(listing, null, 2)}\n`);
      return emit(abLine("images", { role, web_files: listing.web.files.length, worker_files: listing.worker.files.length, markdown: Object.keys(listing.web.md).length + Object.keys(listing.worker.md).length }));
    }
    case "ratio": {
      const decision = decide({ event: process.env.GITHUB_EVENT_NAME, scopeApplies: process.env.SCOPE_APPLIES ?? "", attemptValue: process.env.GITHUB_RUN_ATTEMPT, read: readOut });
      for (const name of ORDER) {
        if (decision.warmups[name]) emit(warmLine(WARMUP_OF[name], decision.warmups[name]));
        if (decision.passes[name]) emit(passLine(name, decision.passes[name].record, decision.passes[name].measured));
      }
      const line = ratioLine(decision);
      emit(line);
      writeFileSync(outPath("d56-ratio.json"), `${JSON.stringify({ line, r: decision.r, applies: decision.applies, attempt: decision.attempt, pass: decision.pass, verdict: decision.verdict, label: decision.label ?? null }, null, 2)}\n`);
      if (!decision.pass) throw new GateError(decision.label, decision.verdict);
      return;
    }
    default:
      throw new Error(`unknown command "${command ?? ""}"`);
  }
}

/** True when this file is the script node was asked to run, through a symlink too. */
const isMain = () => {
  if (!process.argv[1]) return false;
  let given = process.argv[1];
  try {
    given = realpathSync(given);
  } catch {
    // compare it as given
  }
  return pathToFileURL(given).href === import.meta.url || given === fileURLToPath(import.meta.url);
};

if (isMain()) {
  try {
    main();
  } catch (error) {
    const label = error instanceof GateError && error.verdict ? ` ("${error.verdict}")` : "";
    console.error(`::error::${escapeCommand(`D56: ${error.message}${label}`)}`);
    process.exit(1);
  }
}
