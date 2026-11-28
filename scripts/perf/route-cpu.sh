#!/usr/bin/env bash
# D36: CPU per request of each route of the load test's page mix, at a fixed
# rate below saturation, read from the web container's cgroup (cpu.stat), per
# tree. Local only. Each tree gets its own images and database (lib.sh), the
# same seed as D36's full run (load/seed.mjs: 1,000 + 3 × 50 employees), and
# per route a 15 s warm-up, then a measured run.
#   route-cpu.sh <label> <rev>[=<tag>] ...
#   RATE (15/s), DURATION (60s) and ROUTES override the defaults.
# Writes one line per route to scripts/perf/results/<label>.tsv (see HEADER).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
LABEL=$1; shift
RATE="${RATE:-15}"; DURATION="${DURATION:-60s}"
ROUTES="${ROUTES:-/dashboard /employees /employees?page=2 /employees?q=Empleado%201 /org-chart /performance /skills-hub /profile}"
TSV="$PERF_REPO/scripts/perf/results/$LABEL.tsv"
HEADER="label	tag	rev	route	rate	requests	seconds	cpu_us	us_per_request	us_per_request_idle_corrected	idle_us_per_s	p50_ms	p95_ms	status_200_pct	dropped	mem_current_mib	mem_peak_mib	machine"
[ -f "$TSV" ] || printf '%s\n' "$HEADER" > "$TSV"
K6_IMAGE="$(sed -n 's/^K6_IMAGE="\([^"]*\)".*/\1/p' "$PERF_REPO/scripts/load-test.sh")"
OUTDIR="$PERF_REPO/load/.out"; mkdir -p "$OUTDIR/perf"

k6run() { # k6run <route> <duration> <summary file>
  docker run --rm --network host --user "$(id -u):$(id -g)" \
    -v "$PERF_REPO/scripts/perf/route-cpu.js:/perf/route-cpu.js:ro" -v "$OUTDIR:/out" \
    -e BASE_URL=http://localhost:3000 -e SUPABASE_URL="$API_URL" -e ANON_KEY="$ANON_KEY" -e ACCOUNTS=/out/accounts.json \
    -e ROUTE="$1" -e RATE="$RATE" -e DURATION="$2" \
    "$K6_IMAGE" run --quiet --summary-export "/out/perf/$3" /perf/route-cpu.js > "$OUTDIR/perf/${3%.json}.txt" 2>&1 || true
}

for spec in "$@"; do
  rev="${spec%%=*}"; tag="${spec#*=}"; [ "$tag" = "$spec" ] && tag="$(git -C "$PERF_REPO" rev-parse --short "$rev")"
  dir="$(perf_tree "$rev")"
  perf_build "$dir" "$tag"
  perf_switch "$dir" "$tag"
  (cd "$PERF_REPO" && node load/seed.mjs "$DB_URL" "$API_URL" "$SERVICE_KEY" load/.out/accounts.json) > "$PERF_WORK/seed-$tag.log" 2>&1
  perf_cgroup_dirs
  read -r c0 _ _ <<<"$(perf_cgroup)"; t0=$(date +%s.%N); sleep 30
  read -r c1 _ _ <<<"$(perf_cgroup)"; t1=$(date +%s.%N)
  idle=$(awk -v a="$c0" -v b="$c1" -v s="$t0" -v e="$t1" 'BEGIN{printf "%.0f", (b-a)/(e-s)}')
  for route in $ROUTES; do
    name="$LABEL-$tag-$(printf '%s' "$route" | tr -c 'A-Za-z0-9' '_')"
    k6run "$route" 15s "$name-warm.json"
    perf_cgroup_reset_peak
    read -r c0 _ _ <<<"$(perf_cgroup)"; t0=$(date +%s.%N)
    k6run "$route" "$DURATION" "$name.json"
    read -r c1 mem peak <<<"$(perf_cgroup)"; t1=$(date +%s.%N)
    line="$(node -e '
      const [file, c0, c1, t0, t1, idle, mem, peak] = process.argv.slice(1);
      const m = require(file).metrics;
      const n = m["http_reqs{kind:page}"]?.count ?? 0, d = m["http_req_duration{kind:page}"] ?? {};
      const ok = m["checks{check:status 200}"]?.value, dropped = m.dropped_iterations?.count ?? 0;
      const cpu = c1 - c0, secs = t1 - t0, mib = (b) => (b === "NA" ? "NA" : (b / 1048576).toFixed(0));
      const per = n ? cpu / n : NaN, corr = n ? (cpu - idle * secs) / n : NaN;
      console.log([n, secs.toFixed(1), cpu, per.toFixed(0), corr.toFixed(0), idle, (d.med ?? NaN).toFixed(1),
        (d["p(95)"] ?? NaN).toFixed(1), ok === undefined ? "NA" : (100 * ok).toFixed(2), dropped, mib(mem), mib(peak)].join("\t"));
    ' "$OUTDIR/perf/$name.json" "$c0" "$c1" "$t0" "$t1" "$idle" "$mem" "$peak" 2>/dev/null || printf 'NA')"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$LABEL" "$tag" "$(git -C "$dir" rev-parse --short HEAD)" "$route" "$RATE" "$line" "$(perf_machine)" >> "$TSV"
    perf_log "route $tag $route $(printf '%s' "$line" | cut -f1,4,5,8)"
  done
done
perf_log "done $LABEL"
