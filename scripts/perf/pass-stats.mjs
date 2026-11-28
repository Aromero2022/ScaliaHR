// D36: the numbers of one full-run pass of scripts/perf/full-ab.sh, as tab-separated
// fields: p95, p90 and median of the pages in the steady state (ms), requests/s,
// failed %, checks %, isolation %, then the web container's CPU % and median memory
// (MiB) over the hold.
// The hold is k6's own: from RAMP to RAMP + HOLD on the test's clock, as load/pages.js
// tags it. That clock starts at the summary's time minus k6's run time (its last
// "running (…)" line), so the seed before k6 is left out. Fails instead of printing a
// number it cannot back: no steady-state metric, no run time, 1 % or more of the pages
// failed, checks at 99 % or less, another tenant's employees on a page, a cgroup line
// that is not three numbers, samples that do not cover the hold (gaps over 30 s or
// ends more than 20 s inside it), or a CPU counter that goes back (the container
// restarted).
// The p95 is k6's steady phase (from RAMP to the end, ramp-down included); CPU and
// memory cover the hold only.
//   node scripts/perf/pass-stats.mjs <summary.json> <k6 output.txt> <cgroup samples.txt>
import { readFileSync, statSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const seconds = (d) => {
  const m = /^(\d+)(s|m)$/.exec(d);
  if (!m) throw new Error(`a duration like 30s or 4m, got ${d}`);
  return Number(m[1]) * (m[2] === "m" ? 60 : 1);
};

export function passStats(summaryFile, k6File, samplesFile, ramp = process.env.RAMP || "2m", hold = process.env.HOLD || "4m") {
  const m = JSON.parse(readFileSync(summaryFile, "utf8")).metrics;
  const p = m["http_req_duration{kind:page,phase:steady}"];
  if (!p) throw new Error(`${summaryFile}: no steady-state page metric`);
  const f = m["http_req_failed{kind:page}"], iso = m["checks{check:no other tenant's employees}"];
  if (!f || f.value >= 0.01) throw new Error(`${summaryFile}: ${f ? (100 * f.value).toFixed(2) : "no"} % of the pages failed`);
  if (!(m.checks?.value > 0.99)) throw new Error(`${summaryFile}: checks at ${(100 * (m.checks?.value ?? 0)).toFixed(2)} %`);
  if (!iso || iso.value !== 1) throw new Error(`${summaryFile}: the isolation check is ${iso ? (100 * iso.value).toFixed(3) + " %" : "missing"}`);
  const runs = [...readFileSync(k6File, "utf8").matchAll(/running \((?:(\d+)h)?(\d+)m([\d.]+)s\)/g)];
  if (!runs.length) throw new Error(`${k6File}: no "running (…)" line`);
  const [, h, min, sec] = runs.at(-1);
  const start = statSync(summaryFile).mtimeMs / 1000 - (Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec));
  const from = start + seconds(ramp), to = from + seconds(hold);
  const lines = readFileSync(samplesFile, "utf8").trim().split("\n");
  const bad = lines.find((l) => !/^\d+ \d+ \d+( |$)/.test(l));
  if (bad !== undefined) throw new Error(`${samplesFile}: a cgroup line is not three numbers: '${bad}'`);
  const rows = lines.map((l) => l.split(" ").slice(0, 3).map(Number));
  const inHold = rows.filter((r) => r[0] >= from && r[0] <= to);
  if (inHold.length < 10) throw new Error(`${samplesFile}: only ${inHold.length} cgroup samples in the hold`);
  const gap = Math.max(...inHold.slice(1).map((r, i) => r[0] - inHold[i][0]));
  if (inHold[0][0] > from + 20 || inHold.at(-1)[0] < to - 20 || gap > 30) throw new Error(`${samplesFile}: the samples do not cover the hold`);
  for (let i = 1; i < inHold.length; i++) if (inHold[i][1] < inHold[i - 1][1]) throw new Error(`${samplesFile}: the CPU counter went back`);
  const a = inHold[0], b = inHold.at(-1);
  const cpu = (100 * (b[1] - a[1])) / ((b[0] - a[0]) * 1e6);
  const mem = inHold.map((r) => r[2] / 1048576).sort((x, y) => x - y)[Math.floor((inHold.length - 1) / 2)];
  return [p["p(95)"].toFixed(2), p["p(90)"].toFixed(2), p.med.toFixed(2), m.http_reqs.rate.toFixed(2),
    (100 * f.value).toFixed(3), (100 * m.checks.value).toFixed(3), iso ? (100 * iso.value).toFixed(3) : "NA",
    cpu.toFixed(0), mem.toFixed(0)];
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(passStats(...process.argv.slice(2, 5)).join("\t"));
}
