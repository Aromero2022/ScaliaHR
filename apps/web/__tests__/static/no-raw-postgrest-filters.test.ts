import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * D28: PostgREST logic filters are built only with lib/postgrest/filters.ts.
 * A template literal or string concatenation passed to .or() / .filter() /
 * .not() could carry text that closes the group and adds conditions.
 */

const SRC = path.resolve(__dirname, "../../src");
const RAW = /\.(?:or|filter|not)\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+)/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("no PostgREST filter built from raw strings", () => {
  it("the pattern catches the old employees search", () => {
    expect(RAW.test("query.or(`first_name.ilike.%${search}%`)")).toBe(true);
    expect(RAW.test('query.or("id.eq." + id)')).toBe(true);
    expect(RAW.test('query.or(ilikeAnyOf(["email"], search))')).toBe(false);
  });

  for (const file of files(SRC)) {
    const rel = path.relative(SRC, file);
    it(rel, () => {
      const hits = readFileSync(file, "utf-8")
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => RAW.test(line))
        .map(({ line, n }) => `${rel}:${n}: ${line.trim()}`);
      expect(hits).toEqual([]);
    });
  }
});
