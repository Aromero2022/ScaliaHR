#!/usr/bin/env bash
# Secret scanning with gitleaks (D33), pinned by digest, default rules plus
# .gitleaks.toml.
#   bash scripts/check-secrets.sh            the whole git history (npm run check:secrets)
#   bash scripts/check-secrets.sh <dir>...   the files under each directory, e.g. the
#                                            e2e artifacts before CI uploads them (D44)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GITLEAKS="ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"

if [ "$#" -eq 0 ]; then
  cd "$REPO_ROOT"
  exec docker run --rm -v "$PWD:/repo" -w /repo "$GITLEAKS" git --redact --no-banner --config .gitleaks.toml --exit-code 1 .
fi

for dir in "$@"; do
  [ -d "$dir" ] || { echo "::error::$dir is not a directory"; exit 1; }
  abs="$(cd "$dir" && pwd)"
  docker run --rm --user "$(id -u):$(id -g)" \
    -v "$abs:/scan:ro" -v "$REPO_ROOT/.gitleaks.toml:/config/gitleaks.toml:ro" \
    "$GITLEAKS" dir --redact --no-banner --config /config/gitleaks.toml --exit-code 1 /scan
done
