#!/usr/bin/env bash
# D36: an A/B of two trees with the full run of docs/RUNBOOK.md section 9
# (npm run load:test with its defaults: 1,150 users, 20–40 s between pages,
# 2 min ramp, 4 min at full load), on this machine. Local only.
#   full-ab.sh <label> <A rev>[=<tag>] <B rev>[=<tag>] <sequence>     e.g. ABBABAAB
# Each switch of tree: its own images and database (lib.sh) and one unmeasured
# warm-up with the same values; letters of the same tree in a row run back to
# back. The k6 harness is always this checkout's (load/). Web CPU and memory are
# read from the web container's cgroup every 10 s; the hold is 2:10 to 6:00 of
# a pass. Writes scripts/perf/results/<label>.tsv; scripts/perf/analyze-ab.mjs
# gives ln(B/A) with a Student t interval.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
LABEL=$1 A=$2 B=$3 SEQ=$4
TSV="$PERF_REPO/scripts/perf/results/$LABEL.tsv"
[ -f "$TSV" ] || printf 'label\tpass\tarm\ttag\tp95_ms\tp90_ms\tmed_ms\trequests_per_s\tfailed_pct\tchecks_pct\tisolation_pct\tk6_exit\tweb_cpu_pct\tweb_mem_median_mib\tmachine\n' > "$TSV"
OUTDIR="$PERF_REPO/load/.out/$LABEL"; mkdir -p "$OUTDIR"

spec_rev() { printf '%s' "${1%%=*}"; }
spec_tag() { local t="${1#*=}"; [ "$t" = "$1" ] && t="$(git -C "$PERF_REPO" rev-parse --short "$1")"; printf '%s' "$t"; }

pass() { # pass <name> <arm> <tag> <measured 0|1>
  local name=$1 arm=$2 tag=$3 measured=$4 code=0 samples="$OUTDIR/$1-cgroup.txt" started
  : > "$samples"; perf_cgroup_dirs
  ( while true; do printf '%s %s\n' "$(date +%s)" "$(perf_cgroup)" >> "$samples"; sleep 10; done ) &
  local sampler=$!; started=$(date +%s)
  (cd "$PERF_REPO" && LOAD_SUMMARY="summary-$LABEL-$name.json" bash scripts/load-test.sh > "$OUTDIR/k6-$name.txt" 2>&1) || code=$?
  kill "$sampler" 2>/dev/null || true; wait "$sampler" 2>/dev/null || true
  mv "$PERF_REPO/load/.out/summary-$LABEL-$name.json" "$OUTDIR/" 2>/dev/null || true
  local line
  line="$(node -e '
    const [file, samplesFile, started] = process.argv.slice(1);
    const m = require(file).metrics, p = m["http_req_duration{kind:page,phase:steady}"];
    const f = m["http_req_failed{kind:page}"], iso = m["checks{check:no other tenant'"'"'s employees}"];
    const rows = require("fs").readFileSync(samplesFile, "utf8").trim().split("\n").map((l) => l.split(" ").map(Number));
    const hold = rows.filter((r) => r[0] >= +started + 130 && r[0] <= +started + 360);
    let cpu = "NA", mem = "NA";
    if (hold.length > 1) {
      const a = hold[0], b = hold[hold.length - 1];
      cpu = ((100 * (b[1] - a[1])) / ((b[0] - a[0]) * 1e6)).toFixed(0);
      const ms = hold.map((r) => r[2] / 1048576).sort((x, y) => x - y);
      mem = ms[Math.floor((ms.length - 1) / 2)].toFixed(0);
    }
    console.log([p["p(95)"].toFixed(2), p["p(90)"].toFixed(2), p.med.toFixed(2), m.http_reqs.rate.toFixed(2),
      (100 * f.value).toFixed(3), (100 * m.checks.value).toFixed(3), iso ? (100 * iso.value).toFixed(3) : "NA", cpu, mem].join("\t"));
  ' "$OUTDIR/summary-$LABEL-$name.json" "$samples" "$started" 2>/dev/null || printf 'NA\tNA\tNA\tNA\tNA\tNA\tNA\tNA\tNA')"
  perf_log "pass $name arm=$arm tag=$tag measured=$measured k6_exit=$code $(printf '%s' "$line" | tr '\t' ' ')"
  if [ "$measured" = 1 ]; then
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$LABEL" "$name" "$arm" "$tag" "$(printf '%s' "$line" | cut -f1-7)" "$code" "$(printf '%s' "$line" | cut -f8-9)	$(perf_machine)" >> "$TSV"
  fi
}

declare -A DIR TAG
for arm in A B; do
  spec=${!arm}; TAG[$arm]="$(spec_tag "$spec")"; DIR[$arm]="$(perf_tree "$(spec_rev "$spec")")"
  perf_build "${DIR[$arm]}" "${TAG[$arm]}"
done
prev="" n=0 w=0
for (( i=0; i<${#SEQ}; i++ )); do
  arm=${SEQ:$i:1}
  if [ "$arm" != "$prev" ]; then
    perf_switch "${DIR[$arm]}" "${TAG[$arm]}"; w=$((w+1)); pass "w$w-$arm" "$arm" "${TAG[$arm]}" 0
  fi
  n=$((n+1)); pass "p$n-$arm" "$arm" "${TAG[$arm]}" 1
  prev=$arm
done
perf_log "done $LABEL"
