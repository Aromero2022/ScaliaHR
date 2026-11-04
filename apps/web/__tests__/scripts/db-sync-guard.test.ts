import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * D22 — production only ever gets pending migrations applied. These checks run
 * without any database: psql and supabase are stubs that record every call, so
 * a refused sync is shown to stop before touching anything.
 */

const REPO = path.resolve(__dirname, "../../../..");
const GUARD = path.join(REPO, "scripts/lib/db-sync-guard.sh");

function allowed(mode: string, target: string): boolean {
  const run = spawnSync("bash", ["-c", `source "${GUARD}" && db_sync_mode_allowed "$1" "$2"`, "_", mode, target], {
    encoding: "utf-8",
  });
  return run.status === 0;
}

describe("sync mode policy (scripts/lib/db-sync-guard.sh)", () => {
  it.each(["local", "dev", "staging", "production"])("allows the production mode on %s", (target) => {
    expect(allowed("production", target)).toBe(true);
  });

  it.each(["reset", "repair-push"])("refuses %s on production", (mode) => {
    expect(allowed(mode, "production")).toBe(false);
  });

  it.each(["local", "dev", "staging"])("allows reset and repair-push on %s", (target) => {
    expect(allowed("reset", target)).toBe(true);
    expect(allowed("repair-push", target)).toBe(true);
  });

  it.each([
    ["reset", "prod"],
    ["reset", "Production"],
    ["reset", ""],
    ["drop", "dev"],
    ["", "dev"],
  ])("refuses unknown mode %j or target %j", (mode, target) => {
    expect(allowed(mode, target)).toBe(false);
  });
});

describe("destructive scripts stop before touching the database", () => {
  const stubs = mkdtempSync(path.join(tmpdir(), "db-sync-stubs-"));
  const calls = path.join(stubs, "calls.log");
  afterAll(() => rmSync(stubs, { recursive: true, force: true }));

  const stub = (name: string, body: string) => {
    const file = path.join(stubs, name);
    writeFileSync(file, `#!/usr/bin/env bash\necho "${name} $*" >> "${calls}"\n${body}\n`);
    chmodSync(file, 0o755);
  };
  // A database that says it is production when asked about the marker.
  stub("psql", `case "$*" in *production_marker*) echo t ;; esac; exit 0`);
  stub("supabase", "exit 0");

  function run(script: string, ...args: string[]) {
    rmSync(calls, { force: true });
    const result = spawnSync("bash", [path.join(REPO, script), ...args], {
      cwd: REPO,
      encoding: "utf-8",
      env: { ...process.env, PATH: `${stubs}:${process.env.PATH}` },
    });
    const log = existsSync(calls) ? readFileSync(calls, "utf-8") : "";
    return { ...result, log };
  }

  const URL = "postgresql://postgres:pw@db.example.invalid:5432/postgres";

  it("db-reset-sync.sh refuses target production without running a single command", () => {
    const result = run("scripts/db-reset-sync.sh", URL, "production");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not allowed for target 'production'");
    expect(result.log).toBe("");
  });

  it("db-reset-sync.sh requires an explicit target", () => {
    const result = run("scripts/db-reset-sync.sh", URL);
    expect(result.status).not.toBe(0);
    expect(result.log).toBe("");
  });

  it("db-reset-sync.sh refuses a database that carries the production marker, whatever the target", () => {
    const result = run("scripts/db-reset-sync.sh", URL, "dev");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("marked as production");
    expect(result.log).not.toMatch(/TRUNCATE|DROP SCHEMA|db push/);
    expect(result.log.split("\n").filter(Boolean).every((line) => line.startsWith("psql") && line.includes("production_marker"))).toBe(true);
  });

  it("db-reset-sync.sh refuses when the marker cannot be checked (fails closed)", () => {
    stub("psql", "exit 2");
    try {
      const result = run("scripts/db-reset-sync.sh", URL, "dev");
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Could not check the production marker");
      expect(result.log).not.toMatch(/TRUNCATE|DROP SCHEMA|db push/);
    } finally {
      stub("psql", `case "$*" in *production_marker*) echo t ;; esac; exit 0`);
    }
  });

  it("db-migrate-sync.sh never truncates, drops or repairs, and never uses --include-all", () => {
    const script = readFileSync(path.join(REPO, "scripts/db-migrate-sync.sh"), "utf-8");
    const commands = script.split("\n").filter((line) => !line.trim().startsWith("#"));
    expect(commands.join("\n")).not.toMatch(/TRUNCATE|DROP |migration repair|--include-all|db reset/);
  });
});

describe("db-remote-sync.yml (D7, D22)", () => {
  const workflow = readFileSync(path.join(REPO, ".github/workflows/db-remote-sync.yml"), "utf-8");

  function stepIf(name: string): string {
    const match = workflow.match(new RegExp(`- name: "${name.replace(/[()]/g, "\\$&")}"\\n\\s+if: (.+)`));
    if (!match) throw new Error(`step "${name}" has no if:`);
    return match[1];
  }

  it("guards the mode against the target before any other step", () => {
    const guard = workflow.indexOf('- name: "Guard: mode allowed for target"');
    const backup = workflow.indexOf("- name: Backup current state");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(backup);
    expect(workflow.indexOf('- name: "Guard: destructive modes never touch a production database"')).toBeLessThan(backup);
  });

  it.each(["Remote: sync (reset)", "Remote: revoke migration history (repair-push)", "Remote: apply (repair-push)"])(
    "never runs %s against production",
    (name) => {
      expect(stepIf(name)).toContain("inputs.target != 'production'");
    },
  );

  it("applies production through the migrations-only script", () => {
    expect(workflow).toContain('run: bash scripts/db-migrate-sync.sh "$SUPABASE_DB_URL" "$SYNC_TARGET"');
    expect(stepIf("Remote: apply pending migrations (production)")).toBe("inputs.mode == 'production'");
  });
});
