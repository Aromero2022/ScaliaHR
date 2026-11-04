// Prints pg-boss SQL ready to paste into a new file in supabase/migrations (D17).
//   npm -w @scaliahr/worker run pgboss:sql                  -> full install of the pinned version
//   npm -w @scaliahr/worker run pgboss:sql -- migrate <v>   -> upgrade from schema version <v>
// The Supabase CLI already wraps each migration in a transaction, so pg-boss's own
// BEGIN/COMMIT, SET LOCAL timeouts and advisory lock are removed.
import { getConstructionPlans, getMigrationPlans } from "pg-boss";

const [mode, from] = process.argv.slice(2);
const sql =
  mode === "migrate"
    ? getMigrationPlans("pgboss", Number.parseInt(from, 10))
    : getConstructionPlans("pgboss");

const body = sql
  .replace(/^\s*BEGIN;\s*$/m, "")
  .replace(/^\s*SET LOCAL [^;]+;\s*$/gm, "")
  .replace(/^\s*SELECT pg_advisory_xact_lock\(.+\);\s*$/m, "")
  .replace(/^\s*COMMIT;\s*$/m, "");

if (/^\s*(BEGIN|COMMIT);/m.test(body)) {
  throw new Error("pg-boss SQL still contains a transaction statement; update this script");
}
process.stdout.write(`${body.trim()}\n`);
