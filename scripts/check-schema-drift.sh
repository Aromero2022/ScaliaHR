#!/usr/bin/env bash
# Fails when `supabase db diff` reports any statement that is not listed in
# supabase/drift-allowlist.txt.
#
# Usage: scripts/check-schema-drift.sh --db-url <url>
#        scripts/check-schema-drift.sh --linked
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ALLOWLIST="$REPO_ROOT/supabase/drift-allowlist.txt"
WORK="$(mktemp -d)"

# SQL goes to stdout; progress and warnings go to stderr.
if ! supabase db diff "$@" >"$WORK/diff.sql" 2>"$WORK/diff.log"; then
  cat "$WORK/diff.log"
  echo "::error::supabase db diff failed"
  exit 1
fi
cat "$WORK/diff.log"
echo "--- diff (stdout) ---"
cat "$WORK/diff.sql"
echo "---------------------"

trim() { sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }

grep -v '^[[:space:]]*#' "$ALLOWLIST" | trim | sed '/^$/d' | sort -u >"$WORK/allowed"
trim <"$WORK/diff.sql" | sed -e '/^$/d' -e '/^--/d' | sort -u >"$WORK/found"

UNEXPECTED="$(comm -23 "$WORK/found" "$WORK/allowed")"
if [ -n "$UNEXPECTED" ]; then
  echo "::error::Schema drift detected (not in supabase/drift-allowlist.txt):"
  printf '%s\n' "$UNEXPECTED"
  exit 1
fi

ALLOWED_SEEN="$(comm -12 "$WORK/found" "$WORK/allowed")"
if [ -n "$ALLOWED_SEEN" ]; then
  echo "Allowed differences (supabase/drift-allowlist.txt):"
  printf '%s\n' "$ALLOWED_SEEN"
fi
echo "No schema drift."
