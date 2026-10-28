#!/usr/bin/env bash
set -euo pipefail

# D4 — check:forbidden
# Fails if forbidden strings appear in versioned code.
# Run as: npm run check:forbidden
#
# Two categories:
#   1. Old project name — searched across ALL tracked files and filenames,
#      NO exceptions. The pattern is assembled at runtime so this script
#      itself does not contain the literal name.
#   2. Secret patterns — searched only in client-accessible directories,
#      with an allowlist for server-only files that legitimately reference them.

EXIT_CODE=0

# ---------- 1. Old project name (assembled at runtime) ----------

_P1="tal"
_P2="ent"
_P3="go"
OLD_NAME_REGEX="${_P1}${_P2}[_ -]?${_P3}"

CONTENT_HITS=$(git grep -inE "$OLD_NAME_REGEX" -- ':!node_modules' ':!.next' ':!dist' 2>/dev/null || true)
if [ -n "$CONTENT_HITS" ]; then
  echo "FORBIDDEN: Old project name found in file contents:"
  echo "$CONTENT_HITS"
  EXIT_CODE=1
fi

NAME_HITS=$(git ls-files | grep -iE "$OLD_NAME_REGEX" || true)
if [ -n "$NAME_HITS" ]; then
  echo "FORBIDDEN: Old project name found in file/directory names:"
  echo "$NAME_HITS"
  EXIT_CODE=1
fi

# ---------- 2. Secret patterns (client code only) ----------

SECRET_PATTERNS=(
  "service_role"
  "bitnami"
  "MOODLE_WS_TOKEN"
)

CLIENT_DIRS=(
  "apps/web/src"
  "packages"
)

EXCLUDE_DIRS=(
  "node_modules"
  ".next"
  "dist"
)

SECRET_ALLOWLIST=(
  "lib/lms/moodle-client.ts"
  "lib/lms/provision-tenant.ts"
  "lib/jobs/lms-sync.ts"
)

for pattern in "${SECRET_PATTERNS[@]}"; do
  for dir in "${CLIENT_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then continue; fi

    EXCLUDE_ARGS=()
    for exc in "${EXCLUDE_DIRS[@]}"; do
      EXCLUDE_ARGS+=(--exclude-dir="$exc")
    done

    MATCHES=$(grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
      "${EXCLUDE_ARGS[@]}" \
      "$pattern" "$dir" 2>/dev/null || true)

    if [ -n "$MATCHES" ]; then
      FILTERED=""
      while IFS= read -r line; do
        SKIP=false
        for allowed in "${SECRET_ALLOWLIST[@]}"; do
          if [[ "$line" == *"$allowed"* ]]; then
            SKIP=true
            break
          fi
        done
        if [ "$SKIP" = false ]; then
          FILTERED+="$line"$'\n'
        fi
      done <<< "$MATCHES"

      FILTERED=$(echo -n "$FILTERED" | sed '/^$/d')
      if [ -n "$FILTERED" ]; then
        echo "FORBIDDEN: Found '$pattern' in client code:"
        echo "$FILTERED"
        EXIT_CODE=1
      fi
    fi
  done
done

# ---------- Result ----------

if [ $EXIT_CODE -eq 0 ]; then
  echo "check:forbidden passed — no forbidden strings found."
fi

exit $EXIT_CODE
