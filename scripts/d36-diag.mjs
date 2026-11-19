// D36 diagnostics (D54): why the first CI attempt of k6 tends to be slower
// than its rerun. Every command prints one line that starts with "D36-diag: "
// in the log and in the job summary. Nothing here reads or changes the number
// D36 compares: that is still the `{ kind:page,phase:steady }` line of the
// first k6 pass, in the log of the step "k6 load test, short run (D36)".
//   node scripts/d36-diag.mjs runner
//   node scripts/d36-diag.mjs healthy-at <container>         (writes D36_WEB_HEALTHY_AT to $GITHUB_ENV)
//   node scripts/d36-diag.mjs healthy-gap <requests.csv.gz>
//   node scripts/d36-diag.mjs sign-ins <summary.json> <pass>
//   node scripts/d36-diag.mjs requests <requests.csv.gz> <pass> <summary.json>
//   node scripts/d36-diag.mjs standalone <standalone-files.txt>
//   node scripts/d36-diag.mjs second-pass <summary.json> <k6 exit code> <seconds> [<its output>]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

export const PREFIX = "D36-diag: ";
/** k6 exits 99 when a threshold is crossed: for the second pass that is a result, not a failure. */
export const K6_THRESHOLDS_CROSSED = 99;
export const PASSES = ["first", "second"];
export const PHASES = ["ramp", "steady"];

/** A value as it goes on a line: bare when it is a plain token, JSON-quoted otherwise. */
export function formatValue(value) {
  const text = String(value);
  return /^[\w.:+\-/<>]+$/.test(text) ? text : JSON.stringify(text);
}

/** "D36-diag: <topic> key=value …", with the fields in the given order. */
export function diagLine(topic, fields) {
  const pairs = Object.entries(fields).map(([key, value]) => `${key}=${formatValue(value)}`);
  return `${PREFIX}${[topic, ...pairs].join(" ")}`;
}

/** Prints the line, and adds it to the job summary as code, so Markdown never reads its values. */
export function emit(line) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`${line}\`\n\n`);
}

// 1. Runner

/** The CPU model from `lscpu`, or "unavailable". */
export function cpuModel(lscpuText) {
  const match = /^Model name:\s*(.+?)\s*$/m.exec(lscpuText);
  return match ? match[1] : "unavailable";
}

/** MemTotal in kB from /proc/meminfo, or "unavailable". */
export function memTotalKb(meminfoText) {
  const match = /^MemTotal:\s+(\d+)\s+kB$/m.exec(meminfoText);
  return match ? Number(match[1]) : "unavailable";
}

export function runnerLine({ lscpu, nproc, meminfo, runAttempt }) {
  return diagLine("runner", {
    cpu: cpuModel(lscpu),
    nproc: /^\d+$/.test(nproc.trim()) ? Number(nproc.trim()) : "unavailable",
    mem_total_kb: memTotalKb(meminfo),
    run_attempt: runAttempt || "unavailable",
  });
}

// 2. Seconds from the web container's first healthy probe to k6's first request

/**
 * When the container turned healthy, from `docker inspect -f '{{json .State.Health}}'`:
 * the end of the oldest passing probe in its log. Docker keeps only the last
 * five probes, so when all five passed the change may be older: `exact` is false.
 */
export function firstHealthy(health) {
  const log = Array.isArray(health?.Log) ? health.Log : [];
  const passing = log.filter((probe) => probe.ExitCode === 0 && !Number.isNaN(Date.parse(probe.End)));
  if (passing.length === 0) throw new Error(`no passing probe in State.Health.Log (status ${health?.Status ?? "none"})`);
  const oldest = passing.reduce((a, b) => (Date.parse(a.End) <= Date.parse(b.End) ? a : b));
  const exact = !(log.length >= 5 && passing.length === log.length);
  return { at: new Date(Date.parse(oldest.End)).toISOString(), exact };
}

/** The k6 CSV output (`--out csv=…gz`), as rows of named columns. */
export function readCsvRows(gzBytes) {
  const lines = gunzipSync(gzBytes).toString("utf-8").split("\n").filter((line) => line !== "");
  if (lines.length === 0) throw new Error("the k6 CSV is empty");
  const header = lines[0].split(",");
  const col = (name) => {
    const index = header.indexOf(name);
    if (index === -1) throw new Error(`the k6 CSV has no "${name}" column`);
    return index;
  };
  const [metric, time, value, tags] = ["metric_name", "timestamp", "metric_value", "extra_tags"].map(col);
  // Only the first columns are read by position, and URLs, the one field that
  // could hold a comma, come after them; extra_tags is the next to last column.
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return {
      metric: cells[metric],
      time: Number(cells[time]),
      value: Number(cells[value]),
      tags: Object.fromEntries(new URLSearchParams(cells[cells.length - (header.length - tags)] ?? "")),
    };
  });
}

/** The earliest request of the run, in ms since the epoch (the CSV is written with timeFormat=unix_milli). */
export function firstRequestMs(rows) {
  const times = rows.filter((row) => row.metric === "http_reqs").map((row) => row.time);
  if (times.length === 0) throw new Error("the k6 CSV has no http_reqs rows");
  return Math.min(...times);
}

export function healthyGapLine({ healthyAt, exact, firstRequest }) {
  const seconds = (firstRequest - Date.parse(healthyAt)) / 1000;
  return diagLine("healthy to k6", {
    seconds: seconds.toFixed(1),
    web_healthy_at: healthyAt,
    k6_first_request_at: new Date(firstRequest).toISOString(),
    exact: exact ? "yes" : "no",
  });
}

// 3. Sign-ins and retries per phase, from k6's --summary-export

const count = (metrics, name) => {
  const metric = metrics[name];
  if (metric === undefined) return 0; // k6 leaves out a submetric that saw no sample
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

/** The CSV holds values to the microsecond; the summary's are exact. */
const SAME_MS = 0.001;

/**
 * The CSV line of a pass. Its steady-state page p95, avg and max must equal
 * the ones of the same pass's summary export: otherwise the artifact is not the
 * sample k6 measured, and the step fails.
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

// 4. Content hash of the web image's .next/standalone

/** True for a Next.js manifest: its JSON keys come out in a different order from one build to the next. */
export const isManifest = (file) => /manifest/i.test(file.slice(file.lastIndexOf("/") + 1));

export function standaloneLine(filesText) {
  const lines = filesText.split("\n").filter((line) => line !== "");
  if (lines.length === 0) throw new Error("the standalone file list is empty");
  const bad = lines.find((line) => !/^[0-9a-f]{64} {2}\S/.test(line));
  if (bad !== undefined) throw new Error(`not a "<sha256>  <path>" line: ${JSON.stringify(bad)}`);
  const sha = (subset) => createHash("sha256").update(`${subset.join("\n")}\n`).digest("hex");
  const code = lines.filter((line) => !isManifest(line.slice(66)));
  return diagLine("standalone", {
    sha256: sha(lines),
    sha256_without_manifests: sha(code),
    files: lines.length,
    manifests: lines.length - code.length,
    build_id: "replaced",
  });
}

// 6. The second k6 pass: informational, never part of D36

/** The last lines of the second pass's output, without k6's steady-state page line: that line belongs to the D36 run alone. */
export function outputTail(text, lines = 20) {
  return text
    .trimEnd()
    .split("\n")
    .filter((line) => !line.includes("kind:page,phase:steady"))
    .slice(-lines)
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

export function secondPassLine(summary, exitCode, seconds) {
  const code = secondPassExit(exitCode);
  if (!/^\d+$/.test(String(seconds))) throw new Error(`"${seconds}" is not a number of seconds`);
  const metrics = summary?.metrics ?? {};
  const steady = metrics["http_req_duration{kind:page,phase:steady}"];
  const failed = metrics.http_req_failed;
  if (typeof steady?.["p(95)"] !== "number") throw new Error("the second pass's summary has no steady-state page p95");
  if (typeof failed?.passes !== "number" || typeof failed?.fails !== "number") throw new Error("the second pass's summary has no http_req_failed");
  return diagLine("second pass", {
    p95_steady_ms: steady["p(95)"].toFixed(2),
    failed: `${failed.passes}/${failed.passes + failed.fails}`,
    k6_exit: code,
    seconds: Number(seconds),
    counts_for_d36: "no",
  });
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf-8"));
const fileName = (file) => file.slice(file.lastIndexOf("/") + 1);
/** Output of a command, or "" when it is missing or fails: the runner line then says "unavailable". */
const run = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return "";
  }
};
const readOrEmpty = (file) => {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return "";
  }
};

function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "runner":
      return emit(
        runnerLine({
          lscpu: run("lscpu", []),
          nproc: run("nproc", []),
          meminfo: readOrEmpty("/proc/meminfo"),
          runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        }),
      );
    case "healthy-at": {
      const health = JSON.parse(execFileSync("docker", ["inspect", "-f", "{{json .State.Health}}", args[0]], { encoding: "utf-8" }));
      const { at, exact } = firstHealthy(health);
      console.log(`${args[0]} turned healthy at ${at}${exact ? "" : " or earlier (all five probes in its log passed)"}`);
      if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `D36_WEB_HEALTHY_AT=${at}\nD36_WEB_HEALTHY_EXACT=${exact}\n`);
      return;
    }
    case "healthy-gap": {
      const healthyAt = process.env.D36_WEB_HEALTHY_AT;
      if (!healthyAt || Number.isNaN(Date.parse(healthyAt))) throw new Error("D36_WEB_HEALTHY_AT is not set");
      const firstRequest = firstRequestMs(readCsvRows(readFileSync(args[0])));
      return emit(healthyGapLine({ healthyAt, exact: process.env.D36_WEB_HEALTHY_EXACT === "true", firstRequest }));
    }
    case "sign-ins":
      return emit(signInsLine(readJson(args[0]), args[1]));
    case "requests":
      return emit(requestsLine(readCsvRows(readFileSync(args[0])), args[1], fileName(args[0]), readJson(args[2])));
    case "standalone":
      return emit(standaloneLine(readFileSync(args[0], "utf-8")));
    case "second-pass":
      try {
        secondPassExit(args[1]); // a broken run fails on its exit code, not on a missing summary
      } catch (error) {
        if (args[3]) console.error(outputTail(readOrEmpty(args[3])));
        throw error;
      }
      return emit(secondPassLine(readJson(args[0]), args[1], args[2]));
    default:
      throw new Error(`unknown command "${command ?? ""}"`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(`::error::D36-diag: ${error.message}`);
    process.exit(1);
  }
}
