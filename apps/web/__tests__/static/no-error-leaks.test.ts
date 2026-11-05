import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * D27: no database, service or Auth error message reaches the user. Server
 * Actions and pages go through safeError(); client forms use the generic
 * messages of lib/auth/messages.ts. Zod issue messages are our own
 * validation texts and stay allowed.
 */

const SRC = path.resolve(__dirname, "../../src");
const LEAKS = [
  /error:\s*(?:await\s+)?[\w.]+\.message\b/, // { error: err.message }
  /setError\(\s*[\w.]+\.message\s*\)/, // setError(err.message)
  /(?<!\$)\{\s*[\w.]+\.message\s*\}/, // {err.message} in JSX (not ${…} inside a thrown error)
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("no error message reaches the user", () => {
  for (const file of files(SRC)) {
    const rel = path.relative(SRC, file);
    it(rel, () => {
      const hits = readFileSync(file, "utf-8")
        .split("\n")
        .map((line, i) => ({ line: line.replace(/\.issues\[0\]\.message/g, ""), n: i + 1 }))
        .filter(({ line }) => LEAKS.some((pattern) => pattern.test(line)))
        .map(({ line, n }) => `${rel}:${n}: ${line.trim()}`);
      expect(hits).toEqual([]);
    });
  }
});
