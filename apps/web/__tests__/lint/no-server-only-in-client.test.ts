import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Linter, type Rule } from "eslint";
import tsParser from "@typescript-eslint/parser";
import ruleModule from "../../eslint-rules/no-server-only-in-client.mjs";

const rule = ruleModule as unknown as Rule.RuleModule;

/**
 * D30: a client component cannot import a server-only module, directly or
 * through other local modules; Server Action files are references and pass.
 */

const src = mkdtempSync(path.join(tmpdir(), "d30-src-"));
function write(rel: string, content: string) {
  const file = path.join(src, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
write("lib/db/secret.ts", 'import "server-only";\nexport const db = 1;\n');
write("lib/wrapper.ts", 'import { db } from "./db/secret";\nexport const wrapped = db;\n');
write("lib/types-only.ts", 'import type { db } from "./db/secret";\nexport type T = typeof db;\n');
write("lib/plain.ts", "export const plain = 1;\n");
write("app/actions.ts", '"use server";\nimport { db } from "@/lib/db/secret";\nexport async function act() { return db; }\n');
afterAll(() => rmSync(src, { recursive: true, force: true }));

const linter = new Linter({ configType: "flat", cwd: src });
function lint(code: string, file = "components/widget.tsx") {
  return linter.verify(
    code,
    [
      {
        files: ["**/*.tsx", "**/*.ts"],
        languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { scalia: { rules: { "no-server-only-in-client": rule } } },
        rules: { "scalia/no-server-only-in-client": ["error", { srcDir: src }] },
      },
    ],
    path.join(src, file),
  );
}

const CLIENT = '"use client";\n';

describe("scalia/no-server-only-in-client (D30)", () => {
  it("flags a direct import of a server-only module", () => {
    const [message] = lint(CLIENT + 'import { db } from "@/lib/db/secret";');
    expect(message.message).toContain("'@/lib/db/secret' reaches a server-only module");
  });

  it("flags a module that reaches one through local imports, and names the chain", () => {
    const [message] = lint(CLIENT + 'import { wrapped } from "../lib/wrapper";');
    expect(message.message).toContain("lib/wrapper.ts → lib/db/secret.ts");
  });

  it("flags server-only packages and dynamic imports", () => {
    const rules = (code: string) => lint(code).map((m) => m.ruleId);
    const flagged = ["scalia/no-server-only-in-client"];
    expect(rules(CLIENT + 'import { PrismaClient } from "@prisma/client";')).toEqual(flagged);
    expect(rules(CLIENT + 'import "server-only";')).toEqual(flagged);
    expect(rules(CLIENT + 'export async function f() { return import("@/lib/db/secret"); }')).toEqual(flagged);
    expect(rules(CLIENT + 'export { db } from "@/lib/db/secret";')).toEqual(flagged);
  });

  it("allows Server Action files, type-only imports and plain modules", () => {
    expect(lint(CLIENT + 'import { act } from "@/app/actions";')).toEqual([]);
    expect(lint(CLIENT + 'import type { db } from "@/lib/db/secret";\nimport type { T } from "@/lib/types-only";')).toEqual([]);
    expect(lint(CLIENT + 'import { plain } from "@/lib/plain";\nimport { useState } from "react";')).toEqual([]);
  });

  it("leaves server components alone", () => {
    expect(lint('import { db } from "@/lib/db/secret";', "app/page.tsx")).toEqual([]);
  });
});
