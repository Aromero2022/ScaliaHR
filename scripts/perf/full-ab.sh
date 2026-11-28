#!/usr/bin/env bash
# D36: an A/B of two trees with the full run of docs/RUNBOOK.md section 9
# (npm run load:test with its defaults: 1,150 users, 20–40 s between pages,
# 2 min ramp, 4 min at full load), on this machine. Local only.
#   full-ab.sh <label> <A rev>[=<tag>] <B rev>[=<tag>] <sequence>     e.g. ABBABAAB
# Each switch of tree: its own images and database (lib.sh) and one unmeasured
# warm-up with the same values; letters of the same tree in a row run back to
# back. The k6 harness is always this checkout's (load/). Web CPU and memory are
# read from the web container's cgroup every 10 s, and taken over k6's hold
# (scripts/perf/pass-stats.mjs). Writes scripts/perf/results/<label>.tsv;
# scripts/perf/analyze-ab.mjs gives ln(B/A) with a Student t interval.
# A pass that fails (k6 crashed, no summary, too few samples) stops the run and
# writes no line, so a resume with the same label runs it again.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
LABEL=$1 A=$2 B=$3 SEQ=$4
perf_name_ok "$LABEL"
[[ $SEQ =~ ^[AB]+$ ]] && (( ${#SEQ} % 2 == 0 )) || perf_die "the sequence is A and B letters, an even number of them (e.g. ABBABAAB)"
TSV="$PERF_REPO/scripts/perf/results/$LABEL.tsv"
[ -f "$TSV" ] || printf 'label\tpass\tarm\ttag\tp95_ms\tp90_ms\tmed_ms\trequests_per_s\tfailed_pct\tchecks_pct\tisolation_pct\tk6_exit\tweb_cpu_pct\tweb_mem_median_mib\tmachine\n' > "$TSV"
OUTDIR="$PERF_REPO/load/.out/$LABEL"; mkdir -p "$OUTDIR"

spec_rev() { printf '%s' "${1%%=*}"; }
spec_tag() { local t="${1#*=}"; [ "$t" = "$1" ] && t="$(git -C "$PERF_REPO" rev-parse --short "$1")"; printf '%s' "$t"; }

SAMPLER=""
trap '[ -n "$SAMPLER" ] && kill "$SAMPLER" 2>/dev/null || true' EXIT
pass() { # pass <name> <arm> <tag> <measured 0|1>
  local name=$1 arm=$2 tag=$3 measured=$4 code=0 samples="$OUTDIR/$1-cgroup.txt" summary="$OUTDIR/summary-$LABEL-$1.json"
  : > "$samples"; rm -f "$summary" "$PERF_REPO/load/.out/summary-$LABEL-$name.json"; perf_cgroup_dirs
  ( while true; do printf '%s %s\n' "$(date +%s)" "$(perf_cgroup)" >> "$samples"; sleep 10; done ) &
  SAMPLER=$!
  (cd "$PERF_REPO" && LOAD_SUMMARY="summary-$LABEL-$name.json" bash scripts/load-test.sh > "$OUTDIR/k6-$name.txt" 2>&1) || code=$?
  kill "$SAMPLER" 2>/dev/null || true; wait "$SAMPLER" 2>/dev/null || true; SAMPLER=""
  # 0: every threshold of load/pages.js held; 99: one was crossed (the p95 one is
  # expected near saturation; pass-stats.mjs refuses failed pages, failed checks and
  # isolation). Anything else is a failure.
  [ "$code" = 0 ] || [ "$code" = 99 ] || perf_die "pass $name: load-test.sh exited $code (see $OUTDIR/k6-$name.txt)"
  mv "$PERF_REPO/load/.out/summary-$LABEL-$name.json" "$summary" || perf_die "pass $name wrote no summary"
  local line; line="$(node "$PERF_REPO/scripts/perf/pass-stats.mjs" "$summary" "$OUTDIR/k6-$name.txt" "$samples")" || perf_die "pass $name: see the error above"
  perf_log "pass $name arm=$arm tag=$tag measured=$measured k6_exit=$code $(printf '%s' "$line" | tr '\t' ' ')"
  if [ "$measured" = 1 ]; then
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$LABEL" "$name" "$arm" "$tag" "$(printf '%s' "$line" | cut -f1-7)" "$code" "$(printf '%s' "$line" | cut -f8-9)" "$(perf_machine)" >> "$TSV"
  fi
}

declare -A DIR TAG
for arm in A B; do
  spec=${!arm}; TAG[$arm]="$(spec_tag "$spec")"; perf_name_ok "${TAG[$arm]}"; DIR[$arm]="$(perf_tree "$(spec_rev "$spec")")"
  perf_build "${DIR[$arm]}" "${TAG[$arm]}"
done
# Resume: the measured passes already in the TSV for this label are skipped, so
# a series cut short (a restart of the machine) goes on from the next pass. Each
# line kept must be the pass the sequence expects there, with the same tag.
mapfile -t KEPT < <(awk -F'\t' -v l="$LABEL" 'NR > 1 && $1 == l {print (NF == 15 ? $2 "\t" $4 : "incomplete line")}' "$TSV")
(( ${#KEPT[@]} <= ${#SEQ} )) || perf_die "$TSV has ${#KEPT[@]} passes for $LABEL, more than the sequence's ${#SEQ}"
for (( i=0; i<${#KEPT[@]}; i++ )); do
  arm=${SEQ:$i:1}
  [ "${KEPT[$i]}" = "p$((i+1))-$arm	${TAG[$arm]}" ] || perf_die "line $((i+1)) of $TSV is '${KEPT[$i]}', not p$((i+1))-$arm of ${TAG[$arm]}: use another label"
done
done_n=${#KEPT[@]}
prev="" n=0 w=0
for (( i=0; i<${#SEQ}; i++ )); do
  arm=${SEQ:$i:1}
  if (( n < done_n )); then n=$((n+1)); prev=""; continue; fi
  if [ "$arm" != "$prev" ]; then
    perf_switch "${DIR[$arm]}" "${TAG[$arm]}"; w=$((w+1)); pass "w$w-$arm" "$arm" "${TAG[$arm]}" 0
  fi
  n=$((n+1)); pass "p$n-$arm" "$arm" "${TAG[$arm]}" 1
  prev=$arm
done
perf_log "done $LABEL"
