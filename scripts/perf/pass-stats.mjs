// D36: the numbers of one full-run pass of scripts/perf/full-ab.sh, as tab-separated
// fields: p95, p90 and median of the pages in the steady state (ms), requests/s,
// failed %, checks %, isolation %, then the web container's CPU % and median memory
// (MiB) over the hold.
// The hold is k6's own: from RAMP to RAMP + HOLD on the test's clock, as load/pages.js
// tags it. That clock starts at the summary's time minus k6's run time (its last
// "running (…)" line), so the seed before k6 is left out. Fails instead of printing a
// number it cannot back: no steady-state metric, no run time, fewer than 10 cgroup
// samples in the hold, or a CPU counter that goes back (the container restarted).
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
  const runs = [...readFileSync(k6File, "utf8").matchAll(/running \((?:(\d+)h)?(\d+)m([\d.]+)s\)/g)];
  if (!runs.length) throw new Error(`${k6File}: no "running (…)" line`);
  const [, h, min, sec] = runs.at(-1);
  const start = statSync(summaryFile).mtimeMs / 1000 - (Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec));
  const from = start + seconds(ramp), to = from + seconds(hold);
  const rows = readFileSync(samplesFile, "utf8").trim().split("\n").map((l) => l.split(" ").slice(0, 3).map(Number));
  const inHold = rows.filter((r) => r.every(Number.isFinite) && r[0] >= from && r[0] <= to);
  if (inHold.length < 10) throw new Error(`${samplesFile}: only ${inHold.length} cgroup samples in the hold`);
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
