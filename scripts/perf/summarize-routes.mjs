// D36: a table of scripts/perf/route-cpu.sh results: µs of web CPU per request
// (idle-corrected) per route and tree, /employees (its three routes) apart, and
// the average weighted by the load test's page mix (load/pages.js).
// A route is valid only if every request got 200, no iteration was dropped and its
// value is a number; otherwise it shows as NA, and so does the mix of its tag (and
// the /employees average, when the route is one of its three).
// The same tag and route twice in one file is an error.
//   node scripts/perf/summarize-routes.mjs scripts/perf/results/<label>.tsv [tag ...]
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const WEIGHTS = {
  "/dashboard": 3, "/employees": 3, "/employees?page=2": 1, "/employees?q=Empleado%201": 2,
  "/org-chart": 1, "/performance": 2, "/skills-hub": 1, "/profile": 1,
};

export const valid = (r) =>
  r.status_200_pct === "100.00" && r.dropped === "0" && Number.isFinite(Number.parseFloat(r.us_per_request_idle_corrected));

export function summarize(rows) {
  const byTag = new Map();
  for (const r of rows) {
    if (!byTag.has(r.tag)) byTag.set(r.tag, new Map());
    if (byTag.get(r.tag).has(r.route)) throw new Error(`${r.tag} ${r.route} appears twice: use another tag for a new run`);
    byTag.get(r.tag).set(r.route, r);
  }
  const out = [];
  for (const [tag, routes] of byTag) {
    let s = 0, se = 0, ok = true;
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    const totalE = Object.entries(WEIGHTS).filter(([r]) => r.startsWith("/employees")).reduce((a, [, w]) => a + w, 0);
    for (const [route, weight] of Object.entries(WEIGHTS)) {
      const r = routes.get(route);
      if (!r || !valid(r)) { ok = false; continue; }
      const us = Number(r.us_per_request_idle_corrected);
      s += weight * us;
      if (route.startsWith("/employees")) se += weight * us;
    }
    const employeesOk = Object.keys(WEIGHTS).filter((r) => r.startsWith("/employees")).every((r) => routes.get(r) && valid(routes.get(r)));
    out.push({ tag, routes, mix: ok ? s / total : NaN, employees: employeesOk ? se / totalE : NaN });
  }
  return out;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [header, ...lines] = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => l.split("\t"));
  let rows = lines.map((l) => Object.fromEntries(header.map((h, i) => [h, l[i]])));
  const only = process.argv.slice(3);
  if (only.length) rows = rows.filter((r) => only.includes(r.tag));
  if (!rows.length) throw new Error("no rows (or no row with those tags)");
  const routes = Object.keys(WEIGHTS);
  console.log(["tag", ...routes, "/employees (3 routes)", "mix"].join("\t"));
  for (const s of summarize(rows)) {
    const cell = (r) => { const x = s.routes.get(r); return x && valid(x) ? x.us_per_request_idle_corrected : "NA"; };
    const avg = (x) => (Number.isFinite(x) ? x.toFixed(0) : "NA");
    console.log([s.tag, ...routes.map(cell), avg(s.employees), avg(s.mix)].join("\t"));
  }
}
