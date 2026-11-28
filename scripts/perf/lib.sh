# Shared by the scripts in scripts/perf (D36): switching the local stack to
# another tree and measuring it. Local only: the Supabase CLI's stack, Docker
# and k6 on this machine; nothing remote. Source it; the caller sets LABEL.
#
#   PERF_WORK   work directory (default: load/.out/perf, git-ignored)
#   NODE_IMAGE  base image for the builds (default: the Dockerfiles' own)
#   BUILD_PROXY HTTPS proxy passed to the builds, when the network needs one
set -euo pipefail

PERF_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PERF_WORK="${PERF_WORK:-$PERF_REPO/load/.out/perf}"
mkdir -p "$PERF_WORK"

perf_log() { echo "$(date -u +%H:%M:%S) $*"; }

# The machine, for every result line: CPU model, MHz, vCPU and memory.
perf_machine() {
  local model mhz
  model="$(grep -m1 'model name' /proc/cpuinfo | sed 's/.*: //')"
  mhz="$(grep -m1 'cpu MHz' /proc/cpuinfo | sed 's/.*: //' | cut -d. -f1)"
  printf '%s|%sMHz|%svCPU|%skB' "$model" "$mhz" "$(nproc)" "$(awk '/MemTotal/{print $2}' /proc/meminfo)"
}

# DB_URL, API_URL, ANON_KEY and SERVICE_KEY of the running local stack, plus
# what docker-compose.yml needs to join its network.
perf_env() {
  local status; status="$(cd "$PERF_REPO" && supabase status --output env)"
  value() { printf '%s\n' "$status" | sed -n "s/^$1=//p" | head -1 | sed -e 's/^"\(.*\)"$/\1/'; }
  DB_URL="$(value DB_URL)"; API_URL="$(value API_URL)"; ANON_KEY="$(value ANON_KEY)"; SERVICE_KEY="$(value SERVICE_ROLE_KEY)"
  export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
  local db; db="$(docker ps --filter "publish=54322" --format '{{.Names}}' | head -1)"
  export SUPABASE_NETWORK="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$db" | grep '^supabase_network_' | head -1)"
  local mailpit port; mailpit="$(value MAILPIT_URL)"; port="$(printf '%s' "$mailpit" | sed -E 's#^.*:([0-9]+)/?$#\1#')"
  export MAILPIT_HOST="$(docker ps --filter "publish=${port}" --format '{{.Names}}' | head -1)"
}

# A worktree of <rev> under PERF_WORK/trees, created once. Prints its path.
perf_tree() {
  local rev=$1 short dir
  short="$(git -C "$PERF_REPO" rev-parse --short "$rev")"; dir="$PERF_WORK/trees/$short"
  [ -d "$dir" ] || git -C "$PERF_REPO" worktree add -f --detach "$dir" "$rev" >/dev/null 2>&1
  printf '%s' "$dir"
}

# Web and worker images of a tree, tagged scaliahr-web:<tag> and scaliahr-worker:<tag>, once.
perf_build() {
  local dir=$1 tag=$2
  docker image inspect "scaliahr-web:$tag" >/dev/null 2>&1 && return 0
  perf_env
  local args=(--network host --label "org.opencontainers.image.revision=$tag")
  [ -n "${NODE_IMAGE:-}" ] && args+=(--build-arg "NODE_IMAGE=$NODE_IMAGE")
  [ -n "${BUILD_PROXY:-}" ] && args+=(--build-arg "HTTPS_PROXY=$BUILD_PROXY" --build-arg "https_proxy=$BUILD_PROXY")
  perf_log "build $tag"
  (cd "$dir" && docker build "${args[@]}" -f apps/web/Dockerfile \
     --build-arg NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 \
     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" -t "scaliahr-web:$tag" . \
   && docker build "${args[@]}" -f apps/worker/Dockerfile -t "scaliahr-worker:$tag" .) > "$PERF_WORK/build-$tag.log" 2>&1
}

# Points the local stack at a tree: its own database (supabase db reset with its
# migrations), the role passwords, and its images up with its own compose file.
# The Supabase CLI names its containers after the project folder, so the reset
# runs from a copy of the tree's supabase/ in a folder with the repo's name.
perf_switch() {
  local dir=$1 tag=$2 sbp="$PERF_WORK/supabase/$2/$(basename "$PERF_REPO")"
  docker rm -f scaliahr-web-1 scaliahr-worker-1 >/dev/null 2>&1 || true
  [ -d "$sbp/supabase" ] || { mkdir -p "$sbp"; cp -r "$dir/supabase" "$sbp/"; }
  (cd "$sbp" && supabase db reset) > "$PERF_WORK/reset-$tag.log" 2>&1
  perf_env
  [ -f "$dir/.env.docker" ] || cp "$PERF_REPO/.env.docker" "$dir/.env.docker"
  (cd "$PERF_REPO" && node --env-file="$dir/.env.docker" scripts/set-local-role-passwords.mjs "$DB_URL" >/dev/null)
  docker tag "scaliahr-web:$tag" scaliahr-web:local
  docker tag "scaliahr-worker:$tag" scaliahr-worker:local
  (cd "$dir" && docker compose --env-file .env.docker up --no-build --force-recreate --detach --wait --wait-timeout 300) >/dev/null 2>&1
  curl -fsS -o /dev/null http://localhost:3000/api/health
  perf_log "up $tag migrations=$(ls "$sbp/supabase/migrations" | wc -l) web=$(docker inspect -f '{{.Image}}' scaliahr-web-1 | cut -c8-19)"
}

# The web container's cgroup counters, read on the host: CPU used in µs
# (usage_usec of cpu.stat, cgroup v2 or the unified hierarchy of a hybrid
# host), and memory now and at its peak in bytes. perf_cgroup_reset_peak starts
# a new peak.
perf_cgroup_dirs() {
  local id; id="$(docker inspect -f '{{.Id}}' scaliahr-web-1)"
  CG_CPU=""; CG_MEM=""
  for d in /sys/fs/cgroup/unified/docker/$id /sys/fs/cgroup/system.slice/docker-$id.scope /sys/fs/cgroup/docker/$id; do
    [ -f "$d/cpu.stat" ] && { CG_CPU="$d"; break; }
  done
  for d in /sys/fs/cgroup/memory/docker/$id /sys/fs/cgroup/system.slice/docker-$id.scope /sys/fs/cgroup/docker/$id; do
    [ -f "$d/memory.usage_in_bytes" ] || [ -f "$d/memory.current" ] && { CG_MEM="$d"; break; }
  done
  [ -n "$CG_CPU" ] && [ -n "$CG_MEM" ] || { echo "no cgroup for scaliahr-web-1" >&2; return 1; }
}
perf_cgroup() {
  local cpu mem peak
  cpu="$(awk '/^usage_usec/{print $2}' "$CG_CPU/cpu.stat")"
  if [ -f "$CG_MEM/memory.usage_in_bytes" ]; then
    mem="$(cat "$CG_MEM/memory.usage_in_bytes")"; peak="$(cat "$CG_MEM/memory.max_usage_in_bytes")"
  else
    mem="$(cat "$CG_MEM/memory.current")"; peak="$(cat "$CG_MEM/memory.peak" 2>/dev/null || echo NA)"
  fi
  echo "$cpu $mem $peak"
}
perf_cgroup_reset_peak() {
  if [ -f "$CG_MEM/memory.max_usage_in_bytes" ]; then echo 0 > "$CG_MEM/memory.max_usage_in_bytes" 2>/dev/null || true
  elif [ -f "$CG_MEM/memory.peak" ]; then echo 0 > "$CG_MEM/memory.peak" 2>/dev/null || true; fi
}
