#!/usr/bin/env bash
set -euo pipefail

# D4 — check:forbidden
# Fails if forbidden strings appear in client-accessible code.
# Run as: npm run check:forbidden

FORBIDDEN_PATTERNS=(
  "service_role"
  "bitnami"
  "MOODLE_WS_TOKEN"
  "talentgo"
  "TalentGo"
)

SEARCH_DIRS=(
  "apps/web/src"
  "packages"
)

EXCLUDE_DIRS=(
  "node_modules"
  ".next"
  "dist"
)

# Server-only files that legitimately reference secrets
ALLOWLIST=(
  "lib/lms/moodle-client.ts"
  "lib/lms/provision-tenant.ts"
  "lib/jobs/lms-sync.ts"
  "scripts/check-forbidden.sh"
  "supabase/migrations_legacy/"
)

EXIT_CODE=0

for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  for dir in "${SEARCH_DIRS[@]}"; do
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
        for allowed in "${ALLOWLIST[@]}"; do
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

if [ $EXIT_CODE -eq 0 ]; then
  echo "check:forbidden passed — no forbidden strings found."
fi

exit $EXIT_CODE
