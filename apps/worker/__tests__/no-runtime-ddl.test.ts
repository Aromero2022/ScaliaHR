import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PgBoss } from "pg-boss";
import { BOSS_OPTIONS, createBoss, type BossTuning } from "../src/boss.js";

vi.mock("pg-boss", () => ({ PgBoss: vi.fn() }));

/** D17: queues and schema come only from supabase/migrations. */

const SRC = path.resolve(__dirname, "../src");
const FORBIDDEN = [
  /\b(createQueue|updateQueue|deleteQueue)\s*\(/,
  /\b(getConstructionPlans|getMigrationPlans|getRollbackPlans|getUninstallPlans)\b/,
  /\bmigrate\s*:\s*true\b/,
  /\bcreateSchema\s*:\s*true\b/,
  /\b(CREATE|ALTER|DROP|TRUNCATE)\s+(TABLE|INDEX|SCHEMA|FUNCTION|TYPE|ROLE|POLICY)\b/i,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(path.join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [path.join(dir, entry.name)]
        : [],
  );
}

describe("worker never runs DDL", () => {
  it("turns off every pg-boss feature that installs, migrates, reindexes or creates queues", () => {
    expect(BOSS_OPTIONS).toMatchObject({
      migrate: false,
      createSchema: false,
      // the cron timekeeper calls createQueue() on every start
      schedule: false,
      reindex: false,
      // queue stats would create date-named partitions at runtime
      persistQueueStats: false,
    });
  });

  it("keeps those options even if tuning tries to override them", () => {
    const sneaky = { supervise: false, migrate: true, createSchema: true, reindex: true } as BossTuning;
    createBoss("postgresql://u:p@127.0.0.1:1/db", sneaky);
    expect(vi.mocked(PgBoss).mock.calls.at(-1)?.[0]).toMatchObject({
      supervise: false,
      ...BOSS_OPTIONS,
    });
  });

  for (const file of sourceFiles(SRC)) {
    it(`${path.relative(SRC, file)} does not create queues or run DDL`, () => {
      const content = readFileSync(file, "utf-8");
      const hits = FORBIDDEN.filter((pattern) => pattern.test(content)).map(String);
      expect(hits).toEqual([]);
    });
  }
});
