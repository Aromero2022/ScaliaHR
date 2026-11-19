import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DOCKERFILES, dockerfileTurboVersion, lockedTurboVersion } from "../../../../scripts/check-turbo-version.mjs";

/**
 * D17: `turbo prune` in both Dockerfiles runs the turbo of ARG TURBO_VERSION,
 * not the lockfile's. CI fails when the two differ, when the ARG is missing and
 * when the lockfile has no turbo.
 */

const REPO = path.resolve(__dirname, "../../../..");
const SCRIPT = path.join(REPO, "scripts/check-turbo-version.mjs");
const CI = readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf-8");
const STEP = "Dockerfiles pin the lockfile's turbo (D17)";

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const lockfile = (packages: Record<string, unknown>) => JSON.stringify({ name: "scaliahr", lockfileVersion: 3, packages });
const LOCK = lockfile({ "": { name: "scaliahr" }, "node_modules/turbo": { version: "2.11.11" } });

/** A Dockerfile shaped like the real ones: the ARG with its value at the top, redeclared bare in the pruner stage. */
const dockerfile = (arg: string | null) =>
  [
    "ARG NODE_IMAGE=node:22-alpine",
    ...(arg === null ? [] : [arg]),
    "",
    "FROM ${NODE_IMAGE} AS base",
    "FROM base AS pruner",
    "ARG TURBO_VERSION",
    'RUN npx --yes "turbo@${TURBO_VERSION}" prune @scaliahr/web --docker',
    "",
  ].join("\n");

const MATCHING: Record<string, string> = {
  "package-lock.json": LOCK,
  "apps/web/Dockerfile": dockerfile("ARG TURBO_VERSION=2.11.11"),
  "apps/worker/Dockerfile": dockerfile("ARG TURBO_VERSION=2.11.11"),
};

/** A temporary repo with only the given files. */
function fakeRepo(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "d17-turbo-"));
  dirs.push(dir);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  return dir;
}
const without = (files: Record<string, string>, file: string) => Object.fromEntries(Object.entries(files).filter(([name]) => name !== file));
const run = (dir: string) => spawnSync("node", [SCRIPT, dir], { encoding: "utf-8" });

describe("turbo in package-lock.json (D17)", () => {
  it("reads the root node_modules/turbo entry", () => {
    expect(lockedTurboVersion(LOCK)).toBe("2.11.11");
  });

  it("ignores a nested copy of turbo", () => {
    expect(() => lockedTurboVersion(lockfile({ "apps/x/node_modules/turbo": { version: "2.11.11" } }))).toThrow(
      'package-lock.json has no "node_modules/turbo" entry',
    );
  });

  it("throws on a lockfile without packages and on invalid JSON", () => {
    expect(() => lockedTurboVersion(JSON.stringify({ lockfileVersion: 3 }))).toThrow('no "node_modules/turbo" entry');
    expect(() => lockedTurboVersion("{")).toThrow(SyntaxError);
  });
});

describe("ARG TURBO_VERSION in a Dockerfile (D17)", () => {
  it.each([
    ["ARG TURBO_VERSION=2.11.11", "2.11.11"],
    ['ARG TURBO_VERSION="2.11.11"', "2.11.11"],
    ["ARG TURBO_VERSION='2.11.11'", "2.11.11"],
    ["arg TURBO_VERSION=2.11.11", "2.11.11"],
    ["ARG TURBO_VERSION=2.12.0-canary.3", "2.12.0-canary.3"],
  ])("reads %s", (arg, version) => {
    expect(dockerfileTurboVersion(dockerfile(arg))).toBe(version);
  });

  it.each([null, "ARG TURBO_VERSION", "# ARG TURBO_VERSION=9.9.9", "ARG TURBO_VERSION_X=1.2.3"])(
    "finds no version with %s",
    (arg) => {
      expect(() => dockerfileTurboVersion(dockerfile(arg))).toThrow('no "ARG TURBO_VERSION=<version>"');
    },
  );

  it.each(["latest", "^2.11.11", "2.11", ""])("rejects ARG TURBO_VERSION=%s", (value) => {
    expect(() => dockerfileTurboVersion(dockerfile(`ARG TURBO_VERSION=${value}`))).toThrow("not an exact version");
  });

  it("rejects two different values in one Dockerfile", () => {
    const text = `${dockerfile("ARG TURBO_VERSION=2.11.11")}ARG TURBO_VERSION=2.11.10\n`;
    expect(() => dockerfileTurboVersion(text)).toThrow("more than one value: 2.11.11, 2.11.10");
  });
});

describe("check-turbo-version, run as CI runs it (D17)", () => {
  it("passes when both Dockerfiles pin the lockfile's turbo", () => {
    const result = run(fakeRepo(MATCHING));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ARG TURBO_VERSION is 2.11.11 in apps/web/Dockerfile and apps/worker/Dockerfile");
  });

  it("fails on the Dockerfile that pins another turbo, and only on that one", () => {
    const result = run(fakeRepo({ ...MATCHING, "apps/worker/Dockerfile": dockerfile("ARG TURBO_VERSION=2.11.10") }));
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(
      "::error file=apps/worker/Dockerfile::ARG TURBO_VERSION is 2.11.10 but package-lock.json locks turbo 2.11.11; set ARG TURBO_VERSION=2.11.11",
    );
    expect(result.stdout).toBe("");
  });

  it("reports every Dockerfile that differs", () => {
    const result = run(
      fakeRepo({
        ...MATCHING,
        "apps/web/Dockerfile": dockerfile("ARG TURBO_VERSION=2.11.10"),
        "apps/worker/Dockerfile": dockerfile("ARG TURBO_VERSION=2.12.0"),
      }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("::error file=apps/web/Dockerfile::ARG TURBO_VERSION is 2.11.10");
    expect(result.stderr).toContain("::error file=apps/worker/Dockerfile::ARG TURBO_VERSION is 2.12.0");
  });

  it("fails when a Dockerfile has no ARG TURBO_VERSION with a value", () => {
    const result = run(fakeRepo({ ...MATCHING, "apps/web/Dockerfile": dockerfile(null) }));
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe('::error file=apps/web/Dockerfile::no "ARG TURBO_VERSION=<version>"');
  });

  it("fails when a Dockerfile is missing", () => {
    const result = run(fakeRepo(without(MATCHING, "apps/worker/Dockerfile")));
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("::error file=apps/worker/Dockerfile::file not found");
  });

  it("fails when the lockfile has no turbo, is not JSON or is missing", () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ ...MATCHING, "package-lock.json": lockfile({ "": { name: "scaliahr" } }) }, 'package-lock.json has no "node_modules/turbo" entry'],
      [{ ...MATCHING, "package-lock.json": '{\n  "packages": {\n' }, "JSON"],
      [without(MATCHING, "package-lock.json"), "file not found"],
    ];
    for (const [files, message] of cases) {
      const result = run(fakeRepo(files));
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/^::error file=package-lock\.json::/);
      expect(result.stderr).toContain(message);
      expect(result.stderr).toContain("cannot check ARG TURBO_VERSION");
      // One annotation per problem, on a single line.
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
    }
  });

  it("escapes what it quotes from a file, so a value cannot start a workflow command", () => {
    const result = run(fakeRepo({ ...MATCHING, "apps/web/Dockerfile": dockerfile("ARG TURBO_VERSION=9%0A::warning::x") }));
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe('::error file=apps/web/Dockerfile::ARG TURBO_VERSION is "9%250A::warning::x", not an exact version');
  });

  it("passes on this repository's lockfile and Dockerfiles", () => {
    const locked = lockedTurboVersion(readFileSync(path.join(REPO, "package-lock.json"), "utf-8"));
    const result = run(REPO);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`ARG TURBO_VERSION is ${locked}`);
  });
});

// The script reads only the ARG's value. These pin the rest that makes that
// value the turbo `prune` runs: without the stage's bare `ARG TURBO_VERSION`,
// `${TURBO_VERSION}` is empty there and npx fetches the latest turbo.
describe("what the check assumes about the Dockerfiles (D17)", () => {
  it.each(DOCKERFILES)("%s: the only turbo prune runs the ARG's turbo, declared before FROM and redeclared in its stage", (file) => {
    const lines = readFileSync(path.join(REPO, file), "utf-8").split("\n");
    const isFrom = (line: string) => /^FROM\s/i.test(line);
    const valued = lines.findIndex((line) => /^ARG\s+TURBO_VERSION=/i.test(line));
    expect(valued).toBeGreaterThan(-1);
    expect(valued).toBeLessThan(lines.findIndex(isFrom));

    const prunes = lines.flatMap((line, i) => (/\bturbo\b/.test(line) && /\bprune\b/.test(line) && !line.startsWith("#") ? [i] : []));
    expect(prunes).toHaveLength(1);
    const [prune] = prunes;
    expect(lines[prune]).toMatch(/^RUN npx --yes "turbo@\$\{TURBO_VERSION\}" prune /);

    const stage = lines.slice(0, prune).findLastIndex(isFrom);
    expect(stage).toBeGreaterThan(valued);
    expect(lines.slice(stage + 1, prune).some((line) => /^ARG\s+TURBO_VERSION\s*$/i.test(line))).toBe(true);
    expect(lines.filter((line) => line.includes("turbo@")).every((line) => line.includes("turbo@${TURBO_VERSION}"))).toBe(true);
  });
});

/** A job of ci.yml: its header and its steps (each starts with "      - "). */
function job(name: string) {
  const start = CI.indexOf(`\n  ${name}:\n`);
  if (start === -1) throw new Error(`no ${name} job in ci.yml`);
  const rest = CI.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  const [header, ...steps] = (next === -1 ? rest : rest.slice(0, next + 1)).split("\n      - ");
  return { header, steps };
}

describe("where the step sits in CI (D17)", () => {
  const { header, steps } = job("app");
  const index = (needle: string) => steps.findIndex((s) => s.includes(needle));
  const step = steps.find((s) => s.includes(`name: ${STEP}`));

  it("runs the script from the repository root in the app job", () => {
    expect(step).toBeDefined();
    expect(step).toContain("run: node scripts/check-turbo-version.mjs\n");
    expect(step).toContain("working-directory: .");
  });

  it("runs on every push and pull request the app job runs on, and its failure fails the job", () => {
    expect(header).not.toMatch(/^\s+if:/m);
    expect(step).not.toMatch(/^\s+if:/m);
    expect(step).not.toContain("continue-on-error");
  });

  it("runs before the build steps, without the Docker stack", () => {
    const [install, check, prisma] = ["name: Install dependencies", `name: ${STEP}`, "name: Prisma generate"].map(index);
    // Every step is found, so a renamed one fails here instead of comparing -1.
    expect([install, check, prisma].every((i) => i >= 0)).toBe(true);
    expect(check).toBeGreaterThan(install);
    expect(check).toBeLessThan(prisma);
    expect(job("docker").steps.some((s) => s.includes("check-turbo-version"))).toBe(false);
  });
});
