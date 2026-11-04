#!/usr/bin/env bash
# Sourced by scripts/local-up.sh.
#
# require_local_db_url <url>
#   Returns non-zero unless <url> is a postgres URL whose host is 127.0.0.1 or
#   localhost. Query strings are refused because libpq-style parameters such as
#   ?host= can redirect the connection elsewhere.

require_local_db_url() {
  local url="${1:-}"
  local re='^postgres(ql)?://[^@/?#[:space:]]+@(127\.0\.0\.1|localhost)(:[0-9]+)?/[A-Za-z0-9_]+$'
  if [[ ! "$url" =~ $re ]]; then
    echo "::error::Refusing to continue: the database URL is not the local Supabase stack (host must be 127.0.0.1 or localhost, no query string)." >&2
    return 1
  fi
}
