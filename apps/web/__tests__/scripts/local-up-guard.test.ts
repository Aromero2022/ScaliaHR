import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * scripts/local-up.sh must never set passwords on a database that is not on
 * this machine. Both guards (bash in local-up.sh, Node in the password script)
 * refuse anything but 127.0.0.1/localhost without a query string.
 */

const REPO = path.resolve(__dirname, "../../../..");
const GUARD = path.join(REPO, "scripts/lib/local-db-guard.sh");
const PASSWORD_SCRIPT = path.join(REPO, "scripts/set-local-role-passwords.mjs");

const LOCAL = [
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  "postgresql://postgres:postgres@localhost:54322/postgres",
  "postgres://postgres:postgres@127.0.0.1/postgres",
];

const NOT_LOCAL = [
  "",
  "not a url",
  "postgresql://postgres:pw@db.abcdefghij.supabase.co:5432/postgres",
  "postgresql://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
  "postgresql://postgres:pw@127.0.0.1.evil.example:5432/postgres",
  "postgresql://postgres:pw@localhost.evil.example:5432/postgres",
  "postgresql://postgres:pw@10.0.0.5:5432/postgres",
  "postgresql://postgres:pw@127.0.0.1:54322/postgres?host=db.evil.example",
  "postgresql://postgres:pw@localhost:54322/postgres?hostaddr=203.0.113.7",
  "https://postgres:pw@127.0.0.1:54322/postgres",
];

function bashGuard(url: string): number {
  return spawnSync("bash", ["-c", `source "${GUARD}" && require_local_db_url "$1"`, "_", url], {
    encoding: "utf-8",
  }).status ?? -1;
}

const { assertLocalDbUrl } = (await import(PASSWORD_SCRIPT)) as {
  assertLocalDbUrl: (url: string) => string;
};

describe("local database guard (bash)", () => {
  for (const url of LOCAL) {
    it(`accepts ${url}`, () => expect(bashGuard(url)).toBe(0));
  }
  for (const url of NOT_LOCAL) {
    it(`refuses ${JSON.stringify(url)}`, () => expect(bashGuard(url)).not.toBe(0));
  }
});

describe("local database guard (set-local-role-passwords.mjs)", () => {
  for (const url of LOCAL) {
    it(`accepts ${url}`, () => expect(() => assertLocalDbUrl(url)).not.toThrow());
  }
  for (const url of NOT_LOCAL) {
    it(`refuses ${JSON.stringify(url)}`, () => expect(() => assertLocalDbUrl(url)).toThrow());
  }
});

describe("scripts/local-up.sh with a remote database URL", () => {
  const stubs = mkdtempSync(path.join(tmpdir(), "local-up-stubs-"));
  const calls = path.join(stubs, "calls.log");
  afterAll(() => rmSync(stubs, { recursive: true, force: true }));

  const stub = (name: string, body: string) => {
    const file = path.join(stubs, name);
    writeFileSync(file, `#!/usr/bin/env bash\necho "${name} $*" >> "${calls}"\n${body}\n`);
    chmodSync(file, 0o755);
  };
  stub("docker", "exit 0");
  stub("node", "exit 0");
  stub(
    "supabase",
    `if [ "$1" = "status" ]; then echo 'DB_URL="postgresql://postgres:pw@db.abcdefghij.supabase.co:5432/postgres"'; echo 'ANON_KEY="x"'; fi; exit 0`,
  );

  const envFile = path.join(REPO, ".env.docker");
  const envFileExisted = existsSync(envFile);
  const result = spawnSync("bash", [path.join(REPO, "scripts/local-up.sh")], {
    cwd: REPO,
    encoding: "utf-8",
    env: { ...process.env, PATH: `${stubs}:${process.env.PATH}` },
  });
  const log = existsSync(calls) ? readFileSync(calls, "utf-8") : "";

  it("aborts with an error", () => {
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not the local Supabase stack");
  });

  it("never runs the password script nor starts containers", () => {
    expect(log).toMatch(/^supabase status/m);
    expect(log).not.toMatch(/^node .*set-local-role-passwords/m);
    expect(log).not.toMatch(/^docker compose .*\bup\b/m);
  });

  it("does not create .env.docker", () => {
    if (!envFileExisted) expect(existsSync(envFile)).toBe(false);
  });
});
