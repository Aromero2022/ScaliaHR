// D36: a table of scripts/perf/route-cpu.sh results: µs of web CPU per request
// (idle-corrected) per route and tree, /employees (its three routes) apart, and
// the average weighted by the load test's page mix (load/pages.js).
//   node scripts/perf/summarize-routes.mjs scripts/perf/results/<label>.tsv [tag ...]
import { readFileSync } from "node:fs";

export const WEIGHTS = {
  "/dashboard": 3, "/employees": 3, "/employees?page=2": 1, "/employees?q=Empleado%201": 2,
  "/org-chart": 1, "/performance": 2, "/skills-hub": 1, "/profile": 1,
};

export function summarize(rows) {
  const byTag = new Map();
  for (const r of rows) {
    if (!byTag.has(r.tag)) byTag.set(r.tag, new Map());
    byTag.get(r.tag).set(r.route, r);
  }
  const out = [];
  for (const [tag, routes] of byTag) {
    let w = 0, s = 0, we = 0, se = 0;
    for (const [route, weight] of Object.entries(WEIGHTS)) {
      const r = routes.get(route);
      if (!r) continue;
      const us = +r.us_per_request_idle_corrected;
      w += weight; s += weight * us;
      if (route.startsWith("/employees")) { we += weight; se += weight * us; }
    }
    out.push({ tag, routes, mix: w ? s / w : NaN, employees: we ? se / we : NaN });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [header, ...lines] = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => l.split("\t"));
  let rows = lines.map((l) => Object.fromEntries(header.map((h, i) => [h, l[i]])));
  const only = process.argv.slice(3);
  if (only.length) rows = rows.filter((r) => only.includes(r.tag));
  const routes = Object.keys(WEIGHTS);
  console.log(["tag", ...routes, "/employees (3 routes)", "mix"].join("\t"));
  for (const s of summarize(rows)) {
    console.log([s.tag, ...routes.map((r) => s.routes.get(r)?.us_per_request_idle_corrected ?? "NA"), s.employees.toFixed(0), s.mix.toFixed(0)].join("\t"));
  }
}
