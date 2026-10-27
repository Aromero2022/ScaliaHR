#!/usr/bin/env bash
# Exports the variables the integration tests read, taken from the local
# Supabase stack. Must be sourced: `source scripts/supabase-test-env.sh`.
#
# SUPABASE_TEST_DB_URL is deliberately not SUPABASE_DB_URL: db-remote-sync.yml
# holds the remote connection string in SUPABASE_DB_URL.

_status="$(supabase status --output env)" || {
  echo "::error::supabase status failed — is the local stack running?"
  return 1
}

_status_value() {
  printf '%s\n' "$_status" \
    | sed -n "s/^$1=//p" \
    | head -1 \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

export SUPABASE_URL="$(_status_value API_URL)"
export SUPABASE_ANON_KEY="$(_status_value ANON_KEY)"
export SUPABASE_SERVICE_ROLE_KEY="$(_status_value SERVICE_ROLE_KEY)"
export SUPABASE_JWT_SECRET="$(_status_value JWT_SECRET)"
export SUPABASE_TEST_DB_URL="$(_status_value DB_URL)"

_missing=""
for _var in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_JWT_SECRET SUPABASE_TEST_DB_URL; do
  if [ -z "${!_var}" ]; then
    _missing="$_missing $_var"
  fi
done
unset -f _status_value
unset _status _var

if [ -n "$_missing" ]; then
  echo "::error::Empty after reading 'supabase status --output env':$_missing (auth and API must be running)"
  unset _missing
  return 1
fi
unset _missing

echo "Exported SUPABASE_URL=$SUPABASE_URL, SUPABASE_TEST_DB_URL host=$(printf '%s' "$SUPABASE_TEST_DB_URL" | sed -E 's#^[a-z]+://[^@]*@([^/]+)/.*#\1#'), and the anon/service/JWT keys."
