# scripts/perf — local performance measurements (D36)

Tools to repeat the measurements of D36's investigations on your own machine.
They are not part of the D36/D56 harness: they never change `load/`,
`scripts/load-test.sh` or the CI gate, and they reuse the harness as is.

Local only: the Supabase CLI's stack (`supabase start`), Docker and k6 on this
machine. Nothing remote, no paid services. Each tree gets its own web and worker
images and its own database (`supabase db reset` with that tree's migrations),
so after a series the local database holds the last tree's seed.

## Requirements

- `supabase start` running from this checkout, and Docker.
- The host's cgroup files readable from where the scripts run
  (`/sys/fs/cgroup/unified/docker/<id>` or `system.slice/docker-<id>.scope` for
  CPU, `memory/docker/<id>` for memory on cgroup v1).
- Optional: `NODE_IMAGE` (base image for the builds) and `BUILD_PROXY` (an HTTPS
  proxy for the builds) when the network needs them.
- Work files go to `PERF_WORK` (default `load/.out/perf`, git-ignored).

## Per-route CPU at a fixed rate

```bash
bash scripts/perf/route-cpu.sh <label> <rev>[=<tag>] ...
node scripts/perf/summarize-routes.mjs scripts/perf/results/<label>.tsv
```

- Each route of the page mix (`load/pages.js`) runs at `RATE` requests/s
  (default 15, below the single web process's saturation) for `DURATION`
  (default 60 s), after a 15 s warm-up.
- The web container's CPU comes from its cgroup `cpu.stat` (`usage_usec`), so
  it is the CPU of every request of the run, divided by the requests.
  `us_per_request_idle_corrected` subtracts the idle rate measured for 30 s
  before the routes.
- The summary gives µs per request per route, `/employees` (its three routes)
  apart, and the average weighted by the page mix.

## A/B with the full run

```bash
bash scripts/perf/full-ab.sh <label> <A rev>[=<tag>] <B rev>[=<tag>] ABBABAAB
node scripts/perf/analyze-ab.mjs scripts/perf/results/<label>.tsv
```

- Each pass is `npm run load:test` with the values of `docs/RUNBOOK.md`,
  section 9 (1,150 users, 20–40 s between pages). Each switch of tree has one
  unmeasured warm-up.
- The analysis pairs adjacent passes, takes d = ln(p95 B) − ln(p95 A) per
  pair, and gives the mean with a Student t interval. With ABBA, the SD is
  pooled within the two orders of a pair (2 degrees of freedom, t = 4.303).

## Experiments

`experiments/*.patch` are the D43 candidates removed one at a time over
94e2020, for branches that are never merged:

```bash
git worktree add -b exp/d43-table-once ../exp/d43-table-once 94e2020
git -C ../exp/d43-table-once am "$PWD/scripts/perf/experiments/d43-table-once.patch"
bash scripts/perf/route-cpu.sh <label> exp/d43-table-once=d43-table-once
```

## Results

`results/*.tsv` holds every measured line, with the machine (CPU model, MHz,
vCPU and memory) on each one. D36 in `docs/ARCHITECTURE.md` records what they
mean.
