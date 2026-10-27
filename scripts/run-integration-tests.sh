#!/usr/bin/env bash
# Runs the integration suites against the local Supabase stack and fails if
# any test is skipped or marked todo.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/supabase-test-env.sh
source scripts/supabase-test-env.sh

REPORT="$(mktemp -d)/integration-report.json"

cd apps/web
set +e
npx vitest run --config vitest.integration.config.ts \
  --reporter=default --reporter=json --outputFile.json="$REPORT"
VITEST_EXIT=$?
set -e

if [ ! -s "$REPORT" ]; then
  echo "::error::Vitest did not write a JSON report"
  exit 1
fi

node - "$REPORT" <<'NODE'
const report = require(process.argv[2]);
const total = report.numTotalTests;
const passed = report.numPassedTests;
const failed = report.numFailedTests;
const skipped = report.numPendingTests + report.numTodoTests;
console.log(`Integration tests: total=${total} passed=${passed} failed=${failed} skipped=${skipped}`);
let ok = true;
if (total === 0) {
  console.log("::error::No integration tests were collected");
  ok = false;
}
if (skipped > 0) {
  for (const file of report.testResults) {
    for (const t of file.assertionResults) {
      if (t.status === "pending" || t.status === "skipped" || t.status === "todo") {
        console.log(`::error::Skipped: ${file.name} › ${t.fullName}`);
      }
    }
  }
  console.log(`::error::${skipped} integration test(s) were skipped; skips are not allowed`);
  ok = false;
}
process.exit(ok ? 0 : 1);
NODE

exit "$VITEST_EXIT"
