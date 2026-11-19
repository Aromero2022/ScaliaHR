// D36 diagnostics (D54): why the first CI attempt of k6 tends to be slower
// than its rerun. Each diagnostic prints one line that starts with
// "D36-diag: " in the log and in the job summary. Nothing here reads or
// changes the number D36 compares: that is still the
// `{ kind:page,phase:steady }` line of the first k6 pass, in the log of the
// step "k6 load test, short run (D36)".
//   node scripts/d36-diag.mjs runner
//   node scripts/d36-diag.mjs healthy-at <container>   (no D36-diag line: it prints the time and writes
//                                                       D36_WEB_HEALTHY_AT and D36_WEB_HEALTHY_EXACT to $GITHUB_ENV)
//   node scripts/d36-diag.mjs healthy-gap <requests.csv.gz>
//   node scripts/d36-diag.mjs sign-ins <summary.json> <pass>
//   node scripts/d36-diag.mjs standalone <standalone-files.txt>
//   node scripts/d36-diag.mjs requests <requests.csv.gz> <pass> <summary.json>
//   node scripts/d36-diag.mjs second-pass <summary.json> <k6 exit code> <seconds> [<its output>]
// A command that cannot produce its line exits 1 with a "::error::" annotation;
// it never prints a guessed value.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PREFIX = "D36-diag: ";
/** The topics, one per diagnostic. A line with any other topic is a bug. */
export const TOPICS = Object.freeze(["runner", "healthy to k6", "sign-ins", "standalone", "requests", "second pass"]);
/** k6 exits 99 when a threshold is crossed: for the second pass that is a result, not a failure. */
export const K6_THRESHOLDS_CROSSED = 99;
export const PASSES = Object.freeze(["first", "second"]);
export const PHASES = Object.freeze(["ramp", "steady"]);
/** Docker keeps this many health probes in State.Health.Log. */
export const HEALTH_LOG_SIZE = 5;
/** The check in load/pages.js that a page shows no other tenant's employees. */
export const ISOLATION_CHECK = "no other tenant's employees";

const PLAIN = /^[\w.:+\-/<>]+$/;
const KEY = /^[a-z][a-z0-9_]*$/;
/** The whole grammar of a line: prefix, topic, then key=value pairs, a value bare or JSON-quoted. */
export const DIAG_LINE = new RegExp(
  `^${PREFIX}(?:${TOPICS.join("|")})(?: [a-z][a-z0-9_]*=(?:[\\w.:+\\-/<>]+|"(?:[^"\\\\]|\\\\.)*"))+$`,
);

/** A value as it goes on a line: bare when it is a plain token, JSON-quoted otherwise. Only strings and finite numbers. */
export function formatValue(value) {
  if (typeof value === "number" ? !Number.isFinite(value) : typeof value !== "string") {
    throw new Error(`not a string or a finite number: ${String(value)}`);
  }
  const text = String(value);
  return PLAIN.test(text) ? text : JSON.stringify(text);
}

/** "D36-diag: <topic> key=value …", with the fields in the given order; it throws on anything off the grammar. */
export function diagLine(topic, fields) {
  if (!TOPICS.includes(topic)) throw new Error(`unknown topic "${topic}"`);
  const entries = Object.entries(fields);
  if (entries.length === 0) throw new Error(`no fields for "${topic}"`);
  const bad = entries.find(([key]) => !KEY.test(key));
  if (bad) throw new Error(`bad key "${bad[0]}"`);
  const line = `${PREFIX}${[topic, ...entries.map(([key, value]) => `${key}=${formatValue(value)}`)].join(" ")}`;
  if (!DIAG_LINE.test(line)) throw new Error(`not a D36-diag line: ${line}`);
  return line;
}

/** Prints the line, and adds it to the job summary as code, so Markdown never reads its values. */
export function emit(line) {
  console.log(line);
  const fence = line.includes("`") ? "``" : "`";
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${fence} ${line} ${fence}\n\n`);
}

/** A message escaped for a workflow command, so a newline in it cannot start another command. */
export const escapeCommand = (text) => String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

// 1. Runner

/** The CPU model from `lscpu`, or null. */
export function cpuModel(lscpuText) {
  const match = /^Model name:\s*(.+?)\s*$/m.exec(lscpuText);
  return match ? match[1] : null;
}

/** MemTotal in kB from /proc/meminfo, or null. */
export function memTotalKb(meminfoText) {
  const match = /^MemTotal:\s+(\d+)\s+kB$/m.exec(meminfoText);
  return match ? Number(match[1]) : null;
}

/**
 * The runner line. A field that cannot be read says "unavailable" and is
 * listed in `missing`, so the caller can warn with the reason.
 */
export function runnerLine({ lscpu, nproc, meminfo, runAttempt }) {
  const fields = {
    cpu: cpuModel(lscpu),
    nproc: /^\d+$/.test(nproc.trim()) ? Number(nproc.trim()) : null,
    mem_total_kb: memTotalKb(meminfo),
    run_attempt: /^\d+$/.test(runAttempt ?? "") ? Number(runAttempt) : null,
  };
  const missing = Object.keys(fields).filter((key) => fields[key] === null);
  for (const key of missing) fields[key] = "unavailable";
  return { line: diagLine("runner", fields), missing };
}

// 2. Seconds from the web container's first healthy probe to k6's first request

/**
 * When the container turned healthy, from `docker inspect -f '{{json .State.Health}}'`:
 * the end of the first passing probe after the last failing one. When the
 * log holds no failure and is full, older probes rolled out and the change may
 * be older: `exact` is false.
 */
export function firstHealthy(health) {
  if (health?.Status !== "healthy") throw new Error(`the container is not healthy (status ${health?.Status ?? "none"})`);
  const log = Array.isArray(health.Log) ? health.Log : [];
  for (const probe of log) {
    if (Number.isNaN(Date.parse(probe?.End))) throw new Error(`a probe in State.Health.Log has no valid End: ${JSON.stringify(probe?.End)}`);
  }
  const sorted = [...log].sort((a, b) => Date.parse(a.End) - Date.parse(b.End));
  const lastFailure = sorted.map((probe) => probe.ExitCode !== 0).lastIndexOf(true);
  const first = sorted[lastFailure + 1];
  if (first === undefined) throw new Error("no passing probe after the last failing one in State.Health.Log");
  const exact = lastFailure >= 0 || sorted.length < HEALTH_LOG_SIZE;
  return { at: new Date(Date.parse(first.End)).toISOString(), exact };
}

/** The k6 CSV output (`--out csv=…gz`, `timeFormat=unix_milli`), as rows of named columns. */
export function readCsvRows(gzBytes) {
  const lines = gunzipSync(gzBytes).toString("utf-8").split(/\r?\n/).filter((line) => line !== "");
  if (lines.length === 0) throw new Error("the k6 CSV is empty");
  const header = lines[0].split(",");
  const col = (name) => {
    const index = header.indexOf(name);
    if (index === -1) throw new Error(`the k6 CSV has no "${name}" column`);
    return index;
  };
  const [metric, time, value, tags] = ["metric_name", "timestamp", "metric_value", "extra_tags"].map(col);
  return lines.slice(1).map((line, i) => {
    // k6 v1.8.2 percent-encodes tag values, and the URLs here hold no comma. A
    // row with another cell count (a comma somewhere, or another k6 format)
    // fails here instead of being misread.
    const cells = line.split(",");
    if (cells.length !== header.length) throw new Error(`k6 CSV row ${i + 2} has ${cells.length} cells, the header ${header.length}`);
    const number = (cell, name) => {
      const parsed = cell === "" ? NaN : Number(cell);
      if (!Number.isFinite(parsed)) throw new Error(`k6 CSV row ${i + 2}: ${name} "${cell}" is not a number`);
      return parsed;
    };
    return {
      metric: cells[metric],
      time: number(cells[time], "timestamp"),
      value: number(cells[value], "metric_value"),
      tags: Object.fromEntries(new URLSearchParams(cells[tags])),
    };
  });
}

/** The earliest request of the run, in ms since the epoch. */
export function firstRequestMs(rows) {
  let first = Infinity;
  for (const row of rows) if (row.metric === "http_reqs" && row.time < first) first = row.time;
  if (first === Infinity) throw new Error("the k6 CSV has no http_reqs rows");
  return first;
}

export function healthyGapLine({ healthyAt, exact, firstRequest }) {
  const seconds = (firstRequest - Date.parse(healthyAt)) / 1000;
  if (!(seconds >= 0)) throw new Error(`k6's first request (${new Date(firstRequest).toISOString()}) is before the web turned healthy (${healthyAt})`);
  return diagLine("healthy to k6", {
    seconds: seconds.toFixed(1),
    web_healthy_at: healthyAt,
    k6_first_request_at: new Date(firstRequest).toISOString(),
    exact: exact ? "yes" : "no",
  });
}

// 3. Sign-ins and retries per phase, from k6's --summary-export

/** A submetric's count. load/pages.js gives each one a listing threshold, so k6 always exports it, even at 0. */
const count = (metrics, name) => {
  const metric = metrics[name];
  if (metric === undefined) throw new Error(`the k6 summary has no ${name} (is its threshold still in load/pages.js?)`);
  if (typeof metric.count !== "number") throw new Error(`${name} has no count in the summary`);
  return metric.count;
};

export function signInsLine(summary, pass) {
  if (!PASSES.includes(pass)) throw new Error(`unknown pass "${pass}"`);
  const metrics = summary?.metrics;
  if (!metrics || typeof metrics !== "object") throw new Error("the k6 summary has no metrics");
  const fields = { pass };
  for (const phase of PHASES) fields[phase] = count(metrics, `http_reqs{kind:auth,phase:${phase}}`);
  for (const phase of PHASES) fields[`retries_${phase}`] = count(metrics, `sign_in_retries{phase:${phase}}`);
  return diagLine("sign-ins", fields);
}

// 4. Content hash of the web image's .next/standalone

/**
 * True for a Next.js build manifest under .next/ (`…manifest.json`, `…manifest.js`):
 * their JSON keys come out in a different order from one build to the next.
 */
export function isManifest(file) {
  return /(?:^|\/)\.next\//.test(file) && /manifest\.(?:json|js)$/.test(file.slice(file.lastIndexOf("/") + 1));
}

export const MANIFEST_LINE = /^[0-9a-f]{64} {2}\S/;
const PATH_START = 66; // 64 hex digits and two spaces

export function standaloneLine(filesText) {
  const lines = filesText.split("\n").filter((line) => line !== "");
  if (lines.length === 0) throw new Error("the standalone file list is empty");
  const bad = lines.find((line) => !MANIFEST_LINE.test(line));
  if (bad !== undefined) throw new Error(`not a "<sha256>  <path>" line: ${JSON.stringify(bad)}`);
  const sha = (subset) => createHash("sha256").update(`${subset.join("\n")}\n`).digest("hex");
  const code = lines.filter((line) => !isManifest(line.slice(PATH_START)));
  return diagLine("standalone", {
    sha256: sha(lines),
    sha256_without_manifests: sha(code),
    files: lines.length,
    manifests: lines.length - code.length,
    build_id: "replaced",
  });
}

// 5. Per-request durations, uploaded as the job's artifact

/** k6's percentile: linear interpolation between the closest ranks of the sorted values. */
export function percentile(sorted, p) {
  if (sorted.length === 0) throw new Error("no values");
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/** p95, avg and max of the steady-state page durations in the CSV, the samples of D36's submetric. */
export function pageSteadyStats(rows) {
  const values = rows
    .filter((row) => row.metric === "http_req_duration" && row.tags.kind === "page" && row.tags.phase === "steady")
    .map((row) => row.value)
    .sort((a, b) => a - b);
  if (values.length === 0) throw new Error("the k6 CSV has no steady-state page durations");
  return { count: values.length, p95: percentile(values, 0.95), avg: values.reduce((a, b) => a + b, 0) / values.length, max: values[values.length - 1] };
}

/** The CSV writes milliseconds with six decimals; the summary's values are exact. */
const SAME_MS = 0.001;

/**
 * The CSV line of a pass. Its steady-state page p95, avg and max must equal
 * the ones of the same pass's summary export: otherwise the artifact is not the
 * sample k6 measured.
 */
export function requestsLine(rows, pass, file, summary) {
  if (!PASSES.includes(pass)) throw new Error(`unknown pass "${pass}"`);
  const durations = rows.filter((row) => row.metric === "http_req_duration");
  const stats = pageSteadyStats(rows);
  const measured = summary?.metrics?.["http_req_duration{kind:page,phase:steady}"];
  if (typeof measured?.["p(95)"] !== "number") throw new Error("the summary has no steady-state page p95");
  for (const [csvValue, summaryValue, name] of [
    [stats.p95, measured["p(95)"], "p95"],
    [stats.avg, measured.avg, "avg"],
    [stats.max, measured.max, "max"],
  ]) {
    if (!(Math.abs(csvValue - summaryValue) <= SAME_MS)) {
      throw new Error(`the CSV's steady-state page ${name} (${csvValue}) is not the summary's (${summaryValue})`);
    }
  }
  return diagLine("requests", {
    pass,
    artifact: file,
    http_req_duration_rows: durations.length,
    page_steady_rows: stats.count,
    page_p95_steady_ms: stats.p95.toFixed(2),
    matches_summary: "yes",
  });
}

// 6. The second k6 pass: informational, never part of D36

/**
 * The last lines of the second pass's output, indented so none can start a
 * workflow command, and without any line holding "kind:page,phase:steady" or
 * "p(95)" (every p95 of k6's summary): the D36 number belongs to the first
 * pass alone.
 */
export function outputTail(text, lines = 20) {
  return text
    .trimEnd()
    .split("\n")
    .filter((line) => !line.includes("kind:page,phase:steady") && !line.includes("p(95)"))
    .slice(-lines)
    .map((line) => `  ${line}`)
    .join("\n");
}

/** The second pass's k6 exit code: 0, or 99 when a threshold was crossed. Any other code is a broken run. */
export function secondPassExit(exitCode) {
  const code = /^\d+$/.test(String(exitCode)) ? Number(exitCode) : NaN;
  if (Number.isNaN(code)) throw new Error(`k6 exit code "${exitCode}" is not a number`);
  if (code !== 0 && code !== K6_THRESHOLDS_CROSSED) {
    throw new Error(`the second k6 pass failed with exit code ${code}; its output is in the artifact (second-pass.txt)`);
  }
  return code;
}

/**
 * The second pass's line. A threshold crossed is reported; a page that showed
 * another tenant's employees is a failure, whatever the 99 % checks threshold says.
 */
export function secondPassLine(summary, exitCode, seconds) {
  const code = secondPassExit(exitCode);
  if (!/^\d+$/.test(String(seconds))) throw new Error(`"${seconds}" is not a number of seconds`);
  const metrics = summary?.metrics ?? {};
  const steady = metrics["http_req_duration{kind:page,phase:steady}"];
  const failed = metrics.http_req_failed;
  const checks = metrics.checks;
  const isolation = summary?.root_group?.checks?.[ISOLATION_CHECK];
  if (typeof steady?.["p(95)"] !== "number") throw new Error("the second pass's summary has no steady-state page p95");
  if (typeof failed?.passes !== "number" || typeof failed?.fails !== "number") throw new Error("the second pass's summary has no http_req_failed");
  // For a Rate, "passes" counts the true values: failed requests, but succeeded checks.
  if (typeof checks?.passes !== "number" || typeof checks?.fails !== "number") throw new Error("the second pass's summary has no checks");
  if (typeof isolation?.fails !== "number") throw new Error(`the second pass's summary has no "${ISOLATION_CHECK}" check`);
  const line = diagLine("second pass", {
    p95_steady_ms: steady["p(95)"].toFixed(2),
    failed: `${failed.passes}/${failed.passes + failed.fails}`,
    checks_failed: `${checks.fails}/${checks.passes + checks.fails}`,
    tenant_isolation_failed: isolation.fails,
    k6_exit: code,
    seconds: Number(seconds),
    counts_for_d36: "no",
  });
  return { line, isolationFailures: isolation.fails };
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf-8"));
const fileName = (file) => file.slice(file.lastIndexOf("/") + 1);
/** Output of a command, or the reason it gave none: the runner line then says "unavailable". */
const run = (command, args) => {
  try {
    return { text: execFileSync(command, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } }) };
  } catch (error) {
    return { text: "", reason: String(error.stderr || error.message).trim().split("\n")[0] };
  }
};
const readOrEmpty = (file) => {
  try {
    return { text: readFileSync(file, "utf-8") };
  } catch (error) {
    return { text: "", reason: error.code ?? error.message };
  }
};

/** The command's arguments, or a usage error. */
function argsOf(args, names) {
  if (args.length < names.length || args.slice(0, names.length).some((arg) => !arg)) {
    throw new Error(`usage: node scripts/d36-diag.mjs ${names.join(" ")}`);
  }
  return args;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "runner": {
      const lscpu = run("lscpu", []);
      const nproc = run("nproc", []);
      const meminfo = readOrEmpty("/proc/meminfo");
      const { line, missing } = runnerLine({ lscpu: lscpu.text, nproc: nproc.text, meminfo: meminfo.text, runAttempt: process.env.GITHUB_RUN_ATTEMPT });
      const reasons = { cpu: lscpu.reason, nproc: nproc.reason, mem_total_kb: meminfo.reason, run_attempt: "GITHUB_RUN_ATTEMPT is not set" };
      for (const key of missing) console.log(`::warning::${escapeCommand(`D36-diag: runner ${key} unavailable: ${reasons[key] ?? "not in the output"}`)}`);
      return emit(line);
    }
    case "healthy-at": {
      const [container] = argsOf(rest, ["<container>"]);
      const health = JSON.parse(execFileSync("docker", ["inspect", "-f", "{{json .State.Health}}", container], { encoding: "utf-8" }));
      const { at, exact } = firstHealthy(health);
      console.log(`${container} turned healthy at ${at}${exact ? "" : ` or earlier (all ${HEALTH_LOG_SIZE} probes in its log passed)`}`);
      if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `D36_WEB_HEALTHY_AT=${at}\nD36_WEB_HEALTHY_EXACT=${exact}\n`);
      return;
    }
    case "healthy-gap": {
      const [csvFile] = argsOf(rest, ["<requests.csv.gz>"]);
      const healthyAt = process.env.D36_WEB_HEALTHY_AT;
      if (!healthyAt || Number.isNaN(Date.parse(healthyAt))) throw new Error("D36_WEB_HEALTHY_AT is not set");
      const exactValue = process.env.D36_WEB_HEALTHY_EXACT;
      if (exactValue !== "true" && exactValue !== "false") throw new Error("D36_WEB_HEALTHY_EXACT is not set");
      return emit(healthyGapLine({ healthyAt, exact: exactValue === "true", firstRequest: firstRequestMs(readCsvRows(readFileSync(csvFile))) }));
    }
    case "sign-ins": {
      const [summaryFile, pass] = argsOf(rest, ["<summary.json>", "<pass>"]);
      return emit(signInsLine(readJson(summaryFile), pass));
    }
    case "standalone": {
      const [filesFile] = argsOf(rest, ["<standalone-files.txt>"]);
      return emit(standaloneLine(readFileSync(filesFile, "utf-8")));
    }
    case "requests": {
      const [csvFile, pass, summaryFile] = argsOf(rest, ["<requests.csv.gz>", "<pass>", "<summary.json>"]);
      return emit(requestsLine(readCsvRows(readFileSync(csvFile)), pass, fileName(csvFile), readJson(summaryFile)));
    }
    case "second-pass": {
      const [summaryFile, exitCode, seconds, outputFile] = argsOf(rest, ["<summary.json>", "<k6 exit code>", "<seconds>"]);
      // The isolation count goes to the step that fails the job on it as soon
      // as it can be read, whatever k6's exit code and the rest of the summary.
      let summary;
      try {
        summary = readJson(summaryFile);
      } catch {
        summary = undefined; // a broken run may leave no summary: its exit code says why below
      }
      const leaked = summary?.root_group?.checks?.[ISOLATION_CHECK]?.fails;
      if (typeof leaked === "number" && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tenant_isolation_failed=${leaked}\n`);
      try {
        secondPassExit(exitCode); // a broken run fails on its exit code, not on a missing summary
      } catch (error) {
        if (outputFile) console.error(outputTail(readOrEmpty(outputFile).text));
        throw error;
      }
      if (summary === undefined) throw new Error(`cannot read ${summaryFile}`);
      const { line, isolationFailures } = secondPassLine(summary, exitCode, seconds);
      emit(line);
      if (isolationFailures > 0) throw new Error(`${isolationFailures} page(s) of the second pass showed another tenant's employees`);
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
    // A path node ran resolves; if it ever does not, compare it as given rather than give up.
  }
  return pathToFileURL(given).href === import.meta.url || given === fileURLToPath(import.meta.url);
};

if (isMain()) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${escapeCommand(`D36-diag: ${error.message}`)}`);
    process.exit(1);
  }
}
