import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENUM_LABELS, enumLabel, type EnumName } from "@/lib/i18n/es-MX";

/**
 * D42: every value of every enum the migrations create in public has a
 * Spanish label, so no stored value (ACTIVE, ON_TRACK…) reaches the screen
 * untranslated. A new enum or value without a label fails here.
 */

const MIGRATIONS = path.resolve(__dirname, "../../../../supabase/migrations");

/** CREATE TYPE … AS ENUM (…) in public (bare or public.-qualified), one or many lines; later ADD VALUEs too. */
function enumsInMigrations(sql: string): Map<string, Set<string>> {
  const enums = new Map<string, Set<string>>();
  const noComments = sql.replace(/--[^\n]*/g, "");
  const create = /CREATE\s+TYPE\s+(?:(public|"public"|[a-z_]+)\.)?("?)([A-Za-z_]+)\2\s+AS\s+ENUM\s*\(([^)]*)\)/gi;
  for (const [, schema, , name, body] of noComments.matchAll(create)) {
    if (schema && schema.replaceAll('"', "") !== "public") continue;
    const values = [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    enums.set(name, new Set([...(enums.get(name) ?? []), ...values]));
  }
  const addValue = /ALTER\s+TYPE\s+(?:(?:public|"public")\.)?("?)([A-Za-z_]+)\1\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']*)'/gi;
  for (const [, , name, value] of noComments.matchAll(addValue)) {
    enums.set(name, new Set([...(enums.get(name) ?? []), value]));
  }
  return enums;
}

const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf-8"))
  .join("\n");
const fromMigrations = enumsInMigrations(sql);

describe("enum labels (D42)", () => {
  it("finds the enums of the migrations, and only those of public", () => {
    expect(fromMigrations.get("GoalStatus")).toEqual(new Set(["NOT_STARTED", "ON_TRACK", "AT_RISK", "COMPLETED", "CANCELLED"]));
    expect(fromMigrations.get("target_population_type")).toEqual(new Set(["all", "same_department", "direct_reports", "self"]));
    expect(fromMigrations.has("job_state")).toBe(false); // pgboss.job_state is pg-boss's own
  });

  it("has a label for every enum and every value, and nothing else", () => {
    expect(Object.keys(ENUM_LABELS).sort()).toEqual([...fromMigrations.keys()].sort());
    for (const [name, values] of fromMigrations) {
      const labels: Record<string, string> = ENUM_LABELS[name as EnumName];
      expect(Object.keys(labels).sort(), name).toEqual([...values].sort());
      for (const value of values) {
        expect(labels[value].trim().length, `${name}.${value}`).toBeGreaterThan(0);
        // Upper-case codes are never shown as they are.
        if (value === value.toUpperCase()) expect(labels[value], `${name}.${value}`).not.toBe(value);
      }
    }
  });

  it("translates on display only and keeps one label for ON_LEAVE", () => {
    expect(enumLabel("EmployeeStatus", "ACTIVE")).toBe("Activo");
    expect(enumLabel("EmployeeStatus", "ON_LEAVE")).toBe("Con permiso");
    expect(enumLabel("GoalStatus", "ON_TRACK")).toBe("En curso");
    expect(enumLabel("GoalStatus", null)).toBe("—");
    expect(enumLabel("GoalStatus", "SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("parses multi-line, quoted and qualified definitions, and ADD VALUE", () => {
    const parsed = enumsInMigrations(`
      CREATE TYPE "Mood" AS ENUM ('HAPPY',
        'SAD'); -- CREATE TYPE ignored AS ENUM ('X')
      CREATE TYPE public.kind AS ENUM ('a');
      CREATE TYPE other.hidden AS ENUM ('z');
      ALTER TYPE "Mood" ADD VALUE IF NOT EXISTS 'CALM';
    `);
    expect(parsed).toEqual(new Map([["Mood", new Set(["HAPPY", "SAD", "CALM"])], ["kind", new Set(["a"])]]));
  });
});
