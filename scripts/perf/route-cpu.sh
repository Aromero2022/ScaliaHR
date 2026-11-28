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
perf_name_ok "$LABEL"
RATE="${RATE:-15}"; DURATION="${DURATION:-60s}"
[[ $RATE =~ ^[0-9]+$ ]] && [[ $DURATION =~ ^[0-9]+[sm]$ ]] || perf_die "RATE must be a whole number and DURATION like 60s or 2m"
set -f # the routes have ? in them: no globbing
read -ra ROUTE_LIST <<<"${ROUTES:-/dashboard /employees /employees?page=2 /employees?q=Empleado%201 /org-chart /performance /skills-hub /profile}"
set +f
# A path of this app only: no //host or @host that would send the request elsewhere.
for route in "${ROUTE_LIST[@]}"; do [[ $route =~ ^/[A-Za-z0-9_][A-Za-z0-9/_?=%\&.-]*$|^/$ ]] || perf_die "not a local route: '$route'"; done
TSV="$PERF_REPO/scripts/perf/results/$LABEL.tsv"
HEADER="label	tag	rev	route	rate	requests	seconds	cpu_us	us_per_request	us_per_request_idle_corrected	idle_us_per_s	p50_ms	p95_ms	status_200_pct	dropped	mem_current_mib	mem_peak_mib	machine"
[ -f "$TSV" ] || printf '%s\n' "$HEADER" > "$TSV"
K6_IMAGE="$(sed -n 's/^K6_IMAGE="\([^"]*\)".*/\1/p' "$PERF_REPO/scripts/load-test.sh")"
[ -n "$K6_IMAGE" ] || perf_die "no K6_IMAGE in scripts/load-test.sh"
OUTDIR="$PERF_REPO/load/.out"; mkdir -p "$OUTDIR/perf"

k6run() { # k6run <route> <duration> <summary file>; fails when k6 fails or writes no summary
  rm -f "$OUTDIR/perf/$3"
  docker run --rm --network host --user "$(id -u):$(id -g)" \
    -v "$PERF_REPO/scripts/perf/route-cpu.js:/perf/route-cpu.js:ro" -v "$OUTDIR:/out" \
    -e BASE_URL=http://localhost:3000 -e SUPABASE_URL="$API_URL" -e ANON_KEY="$ANON_KEY" -e ACCOUNTS=/out/accounts.json \
    -e ROUTE="$1" -e RATE="$RATE" -e DURATION="$2" \
    "$K6_IMAGE" run --quiet --summary-export "/out/perf/$3" /perf/route-cpu.js > "$OUTDIR/perf/${3%.json}.txt" 2>&1 \
    || perf_die "k6 on $1 ($3): see $OUTDIR/perf/${3%.json}.txt"
  [ -s "$OUTDIR/perf/$3" ] || perf_die "k6 on $1 wrote no summary ($3)"
}

for spec in "$@"; do
  rev="${spec%%=*}"; tag="${spec#*=}"; [ "$tag" = "$spec" ] && tag="$(git -C "$PERF_REPO" rev-parse --short "$rev")"
  perf_name_ok "$tag"
  dir="$(perf_tree "$rev")"
  perf_build "$dir" "$tag"
  perf_switch "$dir" "$tag"
  (cd "$PERF_REPO" && node load/seed.mjs "$DB_URL" "$API_URL" "$SERVICE_KEY" load/.out/accounts.json) > "$PERF_WORK/seed-$tag.log" 2>&1
  perf_cgroup_dirs
  read -r c0 _ _ <<<"$(perf_cgroup)"; t0=$(date +%s.%N); sleep 30
  read -r c1 _ _ <<<"$(perf_cgroup)"; t1=$(date +%s.%N)
  perf_need_num "$c0" "$c1"
  idle=$(awk -v a="$c0" -v b="$c1" -v s="$t0" -v e="$t1" 'BEGIN{printf "%.0f", (b-a)/(e-s)}')
  for route in "${ROUTE_LIST[@]}"; do
    name="$LABEL-$tag-$(printf '%s' "$route" | tr -c 'A-Za-z0-9' '_')"
    k6run "$route" 15s "$name-warm.json"
    perf_cgroup_reset_peak
    read -r c0 _ _ <<<"$(perf_cgroup)"; t0=$(date +%s.%N)
    k6run "$route" "$DURATION" "$name.json"
    read -r c1 mem peak <<<"$(perf_cgroup)"; t1=$(date +%s.%N)
    perf_need_num "$c0" "$c1" "$mem"; [ "$peak" = NA ] || perf_need_num "$peak"
    (( c1 > c0 )) || perf_die "the web container's CPU counter went back (restarted?)"
    line="$(node -e '
      const [file, c0, c1, t0, t1, idle, mem, peak] = process.argv.slice(1);
      const m = require(file).metrics;
      const n = m["http_reqs{kind:page}"]?.count ?? 0, d = m["http_req_duration{kind:page}"] ?? {};
      const ok = m["checks{check:status 200}"]?.value, dropped = m.dropped_iterations?.count ?? 0;
      const cpu = c1 - c0, secs = t1 - t0, mib = (b) => (b === "NA" ? "NA" : (b / 1048576).toFixed(0));
      const per = n ? cpu / n : NaN, corr = n ? (cpu - idle * secs) / n : NaN;
      console.log([n, secs.toFixed(1), cpu, per.toFixed(0), corr.toFixed(0), idle, (d.med ?? NaN).toFixed(1),
        (d["p(95)"] ?? NaN).toFixed(1), ok === undefined ? "NA" : (100 * ok).toFixed(2), dropped, mib(mem), mib(peak)].join("\t"));
    ' "$OUTDIR/perf/$name.json" "$c0" "$c1" "$t0" "$t1" "$idle" "$mem" "$peak")" || perf_die "could not read the summary of $route"
    # A route is only valid if every request got 200 and the rate was held;
    # the line is written either way, and summarize-routes.mjs leaves it out.
    [ "$(printf '%s' "$line" | cut -f9,10)" = "100.00	0" ] || perf_log "warning: $tag $route has non-200 answers or dropped iterations"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$LABEL" "$tag" "$(git -C "$dir" rev-parse --short HEAD)" "$route" "$RATE" "$line" "$(perf_machine)" >> "$TSV"
    perf_log "route $tag $route $(printf '%s' "$line" | cut -f1,4,5,8)"
  done
done
perf_log "done $LABEL"
