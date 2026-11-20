import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  DIAG_LINE,
  ISOLATION_CHECK,
  TOPICS,
  diagLine,
  escapeCommand,
  firstHealthy,
  firstRequestMs,
  formatValue,
  healthyGapLine,
  isManifest,
  outputTail,
  pageSteadyStats,
  percentile,
  readCsvRows,
  requestsLine,
  runnerLine,
  secondPassExit,
  secondPassLine,
  signInsLine,
  standaloneLine,
} from "../../../../scripts/d36-diag.mjs";
import { MARKER, byBytes, replaceBytes, standaloneFiles } from "../../../../scripts/d36-standalone-files.mjs";

/**
 * D54: diagnostics of why the first CI attempt of k6 tends to be slower than
 * its rerun. They add "D36-diag:" lines and an artifact, and must leave alone
 * the number D36 compares: the steady-state page p95 of the first k6 pass.
 */

const REPO = path.resolve(__dirname, "../../../..");
const DIAG = path.join(REPO, "scripts/d36-diag.mjs");
const FILES = path.join(REPO, "scripts/d36-standalone-files.mjs");
const LOAD_TEST = path.join(REPO, "scripts/load-test.sh");
const CI = readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf-8");
const PAGES = readFileSync(path.join(REPO, "load/pages.js"), "utf-8");
const D36_STEP = "k6 load test, short run (D36)";
const SECOND_STEP = "Second k6 pass, informational, not part of D36 (D54)";
const DIAG_STEP = "D36 diagnostics of the first pass (D54)";
const HEALTHY_STEP = "First healthy probe of the web container (D54)";
const ARTIFACT_STEP = "D36 diagnostics artifact (D54)";
const ISOLATION_STEP = "Tenant isolation held in the second k6 pass (D54)";
const BUILD_A = "Jrodzi43SsfnNQNcKwNQC";
const BUILD_B = "I3hwmMoHfS0juqENfgULN";

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

/** A k6 summary export with the D54 submetrics (k6 exports each one, at 0 too, because pages.js gives it a threshold). */
function summary({ ramp = 0, steady = 0, retriesRamp = 0, retriesSteady = 0, isolationFails = 0, checkFails = 0 } = {}) {
  return {
    metrics: {
      "http_req_duration{kind:page,phase:steady}": { avg: 26.51, med: 22.78, "p(90)": 40.28, "p(95)": 51.951, "p(99)": 91.96, max: 162.04 },
      http_req_failed: { passes: 0, fails: 1230, value: 0 },
      checks: { passes: 2385 - checkFails, fails: checkFails, value: 1 },
      "http_reqs{kind:auth,phase:ramp}": { count: ramp, rate: 1 },
      "http_reqs{kind:auth,phase:steady}": { count: steady, rate: 1 },
      "sign_in_retries{phase:ramp}": { count: retriesRamp, rate: 1 },
      "sign_in_retries{phase:steady}": { count: retriesSteady, rate: 0 },
    },
    root_group: { checks: { "no other tenant's employees": { passes: 1155 - isolationFails, fails: isolationFails } } },
  };
}

const LSCPU = "Architecture:  x86_64\nCPU(s):  4\nModel name:  AMD EPYC 7763 64-Core Processor\nBIOS Model name:  pc-q35\n";
const MEMINFO = "MemTotal:       16373428 kB\nMemFree:         1234 kB\n";

describe('the "D36-diag:" line format (D54)', () => {
  it("starts with the fixed prefix and keeps the fields in order", () => {
    expect(diagLine("second pass", { p95_steady_ms: "51.95", counts_for_d36: "no" })).toBe(
      "D36-diag: second pass p95_steady_ms=51.95 counts_for_d36=no",
    );
  });

  it("matches the grammar written by hand here, too", () => {
    const byHand = /^D36-diag: [a-z][a-z0-9 -]*?(?: [a-z][a-z0-9_]*=(?:[\w.:+\-/<>]+|"(?:[^"\\]|\\.)*"))+$/;
    expect(DIAG_LINE.source.startsWith("^D36-diag: (?:runner|healthy to k6|sign-ins|standalone|requests|second pass)")).toBe(true);
    expect('D36-diag: runner cpu="AMD EPYC" nproc=4').toMatch(byHand);
    expect('D36-diag: runner cpu="AMD EPYC" nproc=4').toMatch(DIAG_LINE);
    // The hand-written grammar takes any topic; the module's takes only its own.
    expect("D36-diag: other pass a=1").toMatch(byHand);
    expect("D36-diag: other pass a=1").not.toMatch(DIAG_LINE);
  });

  it.each([
    ["AMD EPYC 7763 64-Core Processor", '"AMD EPYC 7763 64-Core Processor"'],
    ["2026-11-19T18:50:08.123Z", "2026-11-19T18:50:08.123Z"],
    [4, "4"],
    ['say "hi"', '"say \\"hi\\""'],
    ["", '""'],
  ])("writes %j as %s", (value, expected) => {
    expect(formatValue(value)).toBe(expected);
  });

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, true])("refuses %s as a value instead of printing it", (value) => {
    expect(() => formatValue(value)).toThrow("not a string or a finite number");
  });

  it("refuses an unknown topic, a bad key or no fields", () => {
    expect(() => diagLine("third pass", { a: 1 })).toThrow('unknown topic "third pass"');
    expect(() => diagLine("runner", {})).toThrow('no fields for "runner"');
    expect(() => diagLine("runner", { p95Ms: 1 })).toThrow('bad key "p95Ms"');
    expect(() => diagLine("runner", { "p95-ms": 1 })).toThrow('bad key "p95-ms"');
  });

  it("covers every topic with one line, and every line matches the grammar", () => {
    const lines = [
      runnerLine({ lscpu: LSCPU, nproc: "4\n", meminfo: MEMINFO, runAttempt: "2" }).line,
      healthyGapLine({ healthyAt: "2026-11-19T18:50:08.000Z", exact: true, firstRequest: Date.parse("2026-11-19T18:54:22.500Z") }),
      signInsLine(summary(), "first"),
      standaloneLine(`${"a".repeat(64)}  apps/web/server.js\n`),
      requestsLine(readCsvRows(csv(CSV_ROWS)), "first", "requests-first.csv.gz", CSV_SUMMARY),
      secondPassLine(summary(), "0", "92").line,
    ];
    expect(lines.map((line) => TOPICS.find((topic: string) => line.startsWith(`D36-diag: ${topic} `)))).toEqual([...TOPICS]);
    for (const line of lines) expect(line).toMatch(DIAG_LINE);
  });

  it("goes to the job summary too, as code", () => {
    const dir = tempDir("d36-summary-");
    const stepSummary = path.join(dir, "summary.md");
    const file = path.join(dir, "summary.json");
    writeFileSync(file, JSON.stringify(summary({ ramp: 60, steady: 4 })));
    const result = spawnSync("node", [DIAG, "sign-ins", file, "first"], {
      encoding: "utf-8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: stepSummary },
    });
    expect(result.status).toBe(0);
    const line = "D36-diag: sign-ins pass=first ramp=60 steady=4 retries_ramp=0 retries_steady=0";
    expect(result.stdout).toBe(`${line}\n`);
    expect(readFileSync(stepSummary, "utf-8")).toBe(`\` ${line} \`\n\n`);
  });

  it("fails with a workflow error, not a wrong line, on an unknown command or missing arguments", () => {
    for (const args of [["nonsense"], ["sign-ins"], ["requests", "a.csv.gz", "first"]]) {
      const result = spawnSync("node", [DIAG, ...args], { encoding: "utf-8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/^::error::D36-diag: (unknown command "nonsense"|usage: node scripts\/d36-diag\.mjs )/);
    }
  });

  it("escapes its error annotation, so a newline in a message cannot start another command", () => {
    expect(escapeCommand("50% done\n::add-mask::x\r")).toBe("50%25 done%0A::add-mask::x%0D");
    const dir = tempDir("d36-escape-");
    const file = path.join(dir, "summary.json");
    writeFileSync(file, "{}");
    const result = spawnSync("node", [DIAG, "sign-ins", file, "first\n::warning::fake"], { encoding: "utf-8" });
    expect(result.status).toBe(1);
    expect(result.stderr.trim().split("\n")).toEqual(['::error::D36-diag: unknown pass "first%0A::warning::fake"']);
  });

  it("still runs when it is reached through a symlink", () => {
    const dir = tempDir("d36-link-");
    symlinkSync(DIAG, path.join(dir, "d36-diag.mjs"));
    const file = path.join(dir, "summary.json");
    writeFileSync(file, JSON.stringify(summary()));
    const result = spawnSync("node", [path.join(dir, "d36-diag.mjs"), "sign-ins", file, "second"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("D36-diag: sign-ins pass=second");
  });
});

describe("1. the runner (D54)", () => {
  it("names the CPU model, nproc, MemTotal and the run attempt", () => {
    expect(runnerLine({ lscpu: LSCPU, nproc: "4\n", meminfo: MEMINFO, runAttempt: "2" })).toEqual({
      line: 'D36-diag: runner cpu="AMD EPYC 7763 64-Core Processor" nproc=4 mem_total_kb=16373428 run_attempt=2',
      missing: [],
    });
  });

  it('says "unavailable" for what it cannot read, and lists it for a warning', () => {
    expect(runnerLine({ lscpu: "", nproc: "", meminfo: "", runAttempt: undefined })).toEqual({
      line: "D36-diag: runner cpu=unavailable nproc=unavailable mem_total_kb=unavailable run_attempt=unavailable",
      missing: ["cpu", "nproc", "mem_total_kb", "run_attempt"],
    });
  });

  it("warns, with the reason, when the run attempt is missing", () => {
    const env = { ...process.env };
    delete env.GITHUB_RUN_ATTEMPT;
    const result = spawnSync("node", [DIAG, "runner"], { encoding: "utf-8", env });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning::D36-diag: runner run_attempt unavailable: GITHUB_RUN_ATTEMPT is not set");
    expect(result.stdout).toMatch(/^D36-diag: runner .* run_attempt=unavailable$/m);
  });
});

const probe = (end: string, exitCode: number) => ({ Start: end, End: end, ExitCode: exitCode, Output: "" });
const at = (seconds: number) => new Date(Date.parse("2026-11-19T18:50:00Z") + seconds * 1000).toISOString();

describe("2. seconds from the first healthy probe to k6 (D54)", () => {
  it("takes the first passing probe after the last failing one, as an exact time", () => {
    const health = { Status: "healthy", Log: [probe("2026-11-19T18:49:50.100000000Z", 1), probe("2026-11-19T18:50:00.250000000Z", 0), probe(at(20), 0)] };
    expect(firstHealthy(health)).toEqual({ at: "2026-11-19T18:50:00.250Z", exact: true });
  });

  it("skips a pass that a later failure undid (a flapping container)", () => {
    const health = { Status: "healthy", Log: [probe(at(0), 0), probe(at(10), 1), probe(at(20), 0), probe(at(30), 0), probe(at(40), 0)] };
    expect(firstHealthy(health)).toEqual({ at: at(20), exact: true });
  });

  it("is exact with fewer than five probes, and not when all five passed: the change may be older", () => {
    expect(firstHealthy({ Status: "healthy", Log: [probe(at(0), 0), probe(at(10), 0)] })).toEqual({ at: at(0), exact: true });
    const full = [0, 10, 20, 30, 40].map((s) => probe(at(s), 0));
    expect(firstHealthy({ Status: "healthy", Log: full })).toEqual({ at: at(0), exact: false });
  });

  it("fails when the container is not healthy, no probe passed after the last failure, or a probe has no time", () => {
    expect(() => firstHealthy({ Status: "starting", Log: [probe(at(0), 0)] })).toThrow("not healthy (status starting)");
    expect(() => firstHealthy(null)).toThrow("not healthy (status none)");
    expect(() => firstHealthy({ Status: "healthy", Log: [probe(at(0), 0), probe(at(10), 1)] })).toThrow("no passing probe after the last failing one");
    expect(() => firstHealthy({ Status: "healthy", Log: [{ ExitCode: 0, End: "soon" }] })).toThrow("has no valid End");
  });

  it("measures up to k6's first request, read from its CSV", () => {
    const first = firstRequestMs(readCsvRows(csv(CSV_ROWS)));
    expect(first).toBe(1795115428109);
    expect(healthyGapLine({ healthyAt: "2026-11-19T19:06:18.992Z", exact: false, firstRequest: first })).toBe(
      "D36-diag: healthy to k6 seconds=249.1 web_healthy_at=2026-11-19T19:06:18.992Z k6_first_request_at=2026-11-19T19:10:28.109Z exact=no",
    );
  });

  it("refuses a gap below zero instead of printing it", () => {
    expect(() => healthyGapLine({ healthyAt: "2026-11-19T19:20:00.000Z", exact: true, firstRequest: 1795115428109 })).toThrow("is before the web turned healthy");
  });

  it("handles a long run's CSV without spreading every timestamp into one call", () => {
    const rows = Array.from({ length: 200_000 }, (_, i) => ({ metric: "http_reqs", time: 2_000_000 - i, value: 1, tags: {} }));
    expect(firstRequestMs(rows)).toBe(1_800_001);
  });

  it("fails when the earlier step did not record the healthy time or whether it is exact", () => {
    const dir = tempDir("d36-gap-");
    const file = path.join(dir, "requests.csv.gz");
    writeFileSync(file, csv(CSV_ROWS));
    const env = { ...process.env };
    delete env.D36_WEB_HEALTHY_AT;
    delete env.D36_WEB_HEALTHY_EXACT;
    let result = spawnSync("node", [DIAG, "healthy-gap", file], { encoding: "utf-8", env });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("D36_WEB_HEALTHY_AT is not set");
    result = spawnSync("node", [DIAG, "healthy-gap", file], { encoding: "utf-8", env: { ...env, D36_WEB_HEALTHY_AT: "2026-11-19T19:06:18.992Z" } });
    expect(result.stderr).toContain("D36_WEB_HEALTHY_EXACT is not set");
  });

  it("is read right after local:up, before the e2e, from the web container", () => {
    const names = dockerSteps().map(stepName);
    const healthy = names.indexOf(HEALTHY_STEP);
    expect(healthy).toBe(names.indexOf("Build images and start the local stack (npm run local:up)") + 1);
    expect(healthy).toBeLessThan(names.indexOf("e2e with axe, zoom and screenshots (D44)"));
    expect(stepNamed(HEALTHY_STEP)).toContain("run: node scripts/d36-diag.mjs healthy-at scaliahr-web-1");
  });
});

describe("3. sign-ins and retries per phase (D54)", () => {
  it("reads the per-phase counts of the summary export", () => {
    expect(signInsLine(summary({ ramp: 71, steady: 4, retriesRamp: 2 }), "second")).toBe(
      "D36-diag: sign-ins pass=second ramp=71 steady=4 retries_ramp=2 retries_steady=0",
    );
  });

  it("fails on a missing submetric instead of counting it as 0", () => {
    const missing = summary();
    delete (missing.metrics as Record<string, unknown>)["sign_in_retries{phase:steady}"];
    expect(() => signInsLine(missing, "first")).toThrow("the k6 summary has no sign_in_retries{phase:steady} (is its threshold still in load/pages.js?)");
  });

  it("rejects an unknown pass, a summary without metrics and a metric without a count", () => {
    expect(() => signInsLine(summary(), "third")).toThrow('unknown pass "third"');
    expect(() => signInsLine({}, "first")).toThrow("the k6 summary has no metrics");
    const noCount = summary();
    noCount.metrics["http_reqs{kind:auth,phase:ramp}"] = { rate: 1 } as never;
    expect(() => signInsLine(noCount, "first")).toThrow("has no count");
  });
});

/** A fake .next/standalone with BUILD_ID in a path, in file contents and in the skipped static folder. */
function standaloneTree(buildId: string): string {
  const root = tempDir("d36-standalone-");
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  };
  write("apps/web/.next/BUILD_ID", `${buildId}\n`);
  write("apps/web/server.js", "require('next')\n");
  write("apps/web/.next/server/pages/500.html", `<script src="/_next/static/${buildId}/_buildManifest.js"></script>`);
  write("apps/web/.next/build-manifest.json", `{"buildId":"${buildId}"}`);
  write(`apps/web/.next/server/${buildId}/data.json`, "{}");
  write("apps/web/.next/server/M/data.json", "{}");
  write(`apps/web/.next/static/${buildId}/_buildManifest.js`, "static, left out");
  write("node_modules/react/index.js", "module.exports = {}\n");
  symlinkSync("../react/index.js", path.join(root, "node_modules/react/link.js"));
  return root;
}

describe("4. the content hash of .next/standalone (D54)", () => {
  it("replaces BUILD_ID in every path and every file, sorts by the replaced path, and leaves .next/static out", () => {
    const files = standaloneFiles(standaloneTree(BUILD_A));
    expect(files.map((line: string) => line.slice(66))).toEqual([
      "apps/web/.next/BUILD_ID",
      "apps/web/.next/build-manifest.json",
      `apps/web/.next/server/${MARKER}/data.json`,
      "apps/web/.next/server/M/data.json",
      "apps/web/.next/server/pages/500.html",
      "apps/web/server.js",
      "node_modules/react/index.js",
      "node_modules/react/link.js",
    ]);
    expect(standaloneLine(`${files.join("\n")}\n`)).toMatch(DIAG_LINE);
  });

  it("gives the same list for two builds that differ only in BUILD_ID, wherever the ids sort", () => {
    // "a…" sorts after "M" and "Z…" before it: the order must not follow the id.
    expect(standaloneFiles(standaloneTree(`a${BUILD_A}`))).toEqual(standaloneFiles(standaloneTree(`Z${BUILD_B}`)));
    expect(standaloneFiles(standaloneTree(BUILD_A))).toEqual(standaloneFiles(standaloneTree(BUILD_B)));
  });

  it("orders paths by their UTF-8 bytes", () => {
    expect(["～", "😀", "a"].sort(byBytes)).toEqual(["a", "～", "😀"]);
  });

  it("changes when a file's content changes", () => {
    const a = standaloneTree(BUILD_A);
    const b = standaloneTree(BUILD_A);
    writeFileSync(path.join(b, "apps/web/server.js"), "require('next') // changed\n");
    expect(standaloneFiles(a)).not.toEqual(standaloneFiles(b));
  });

  it("hashes a symlink by its target instead of following it", () => {
    const a = standaloneTree(BUILD_A);
    const b = standaloneTree(BUILD_A);
    writeFileSync(path.join(b, "node_modules/react/index.js"), "module.exports = { changed: true }\n");
    const link = (root: string) => standaloneFiles(root).find((line: string) => line.endsWith("link.js"));
    expect(link(a)).toBe(link(b));
  });

  it("refuses an empty needle, and a BUILD_ID that is missing or not an id", () => {
    expect(() => replaceBytes(Buffer.from("abc"), Buffer.from(""), Buffer.from("x"))).toThrow("an empty needle");
    const root = standaloneTree(BUILD_A);
    writeFileSync(path.join(root, "apps/web/.next/BUILD_ID"), "x\n");
    expect(() => standaloneFiles(root)).toThrow('apps/web/.next/BUILD_ID does not hold a build id: "x"');
    const result = spawnSync("node", [FILES, tempDir("d36-empty-")], { encoding: "utf-8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("cannot read apps/web/.next/BUILD_ID: ENOENT");
  });

  it("prints the hash of all files and of all but the .next manifests, whose keys come in a different order each build", () => {
    const lines = [`${"1".repeat(64)}  apps/web/.next/app-path-routes-manifest.json`, `${"2".repeat(64)}  apps/web/server.js`];
    const line = standaloneLine(`${lines.join("\n")}\n`);
    expect(line).toMatch(/^D36-diag: standalone sha256=[0-9a-f]{64} sha256_without_manifests=[0-9a-f]{64} files=2 manifests=1 build_id=replaced$/);
    // Reordering a manifest's keys changes only the first hash.
    const reordered = standaloneLine(`${"3".repeat(64)}  apps/web/.next/app-path-routes-manifest.json\n${lines[1]}\n`);
    const field = (text: string, key: string) => new RegExp(` ${key}=([0-9a-f]+)`).exec(text)?.[1];
    expect(field(reordered, "sha256")).not.toBe(field(line, "sha256"));
    expect(field(reordered, "sha256_without_manifests")).toBe(field(line, "sha256_without_manifests"));
  });

  it.each([
    ["apps/web/.next/server/app/(protected)/dashboard/page_client-reference-manifest.js", true],
    ["apps/web/.next/server/server-reference-manifest.json", true],
    ["apps/web/.next/app-path-routes-manifest.json", true],
    ["node_modules/some-lib/manifest.js", false],
    ["apps/web/.next/server/chunks/manifest-utils.js", false],
    ["apps/web/.next/server/manifest-free/page.js", false],
    ["node_modules/x.next/build-manifest.json", false],
  ])("counts %s as a manifest: %s", (file, expected) => {
    expect(isManifest(file)).toBe(expected);
  });

  it("rejects a list that is empty or not made of manifest lines", () => {
    expect(() => standaloneLine("")).toThrow("the standalone file list is empty");
    expect(() => standaloneLine("not a hash  file\n")).toThrow('not a "<sha256>  <path>" line');
  });

  it("is computed inside the image the measured container runs, offline, read-only and without privileges", () => {
    const run = runBlock(stepNamed(DIAG_STEP));
    expect(run).toContain(`image="$(docker inspect -f '{{.Image}}' scaliahr-web-1)"`);
    expect(run).toContain("docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges");
    expect(run).toContain('--entrypoint node -v "$PWD/scripts/d36-standalone-files.mjs:/d36/standalone-files.mjs:ro"');
    expect(run).toContain('"$image" /d36/standalone-files.mjs /app > load/.out/standalone-files.txt; then');
  });
});

const CSV_HEADER =
  "metric_name,timestamp,metric_value,check,error,error_code,expected_response,group,method,name,proto,scenario,service,status,subproto,tls_version,url,extra_tags,metadata";
// Lines as k6 v1.8.2 writes them (--out csv=…,timeFormat=unix_milli), from a run against a local stub.
const CSV_ROWS = [
  "http_reqs,1795115428109,1.000000,,,1400,false,,POST,http://127.0.0.1:54399/auth/v1/token?grant_type=password,HTTP/1.1,other_tenants_load-c,,400,,,http://127.0.0.1:54399/auth/v1/token?grant_type=password,kind=auth&phase=ramp,",
  "http_req_duration,1795115432106,0.491990,,,,true,,POST,http://127.0.0.1:54399/auth/v1/token?grant_type=password,HTTP/1.1,other_tenants_load-b,,200,,,http://127.0.0.1:54399/auth/v1/token?grant_type=password,phase=steady&kind=auth,",
  "http_req_duration,1795115428123,9.882309,,,,true,,GET,http://127.0.0.1:3999/employees,HTTP/1.1,other_tenants_load-a,,200,,,http://127.0.0.1:3999/employees,page=/employees&kind=page&phase=ramp,",
  "http_req_duration,1795115432118,11.803474,,,,true,,GET,http://127.0.0.1:3999/profile,HTTP/1.1,other_tenants_load-b,,200,,,http://127.0.0.1:3999/profile,page=/profile&kind=page&phase=steady,",
  "http_reqs,1795115429244,1.000000,,,,true,,GET,http://127.0.0.1:3999/employees?q=Empleado%201,HTTP/1.1,one_tenant,,200,,,http://127.0.0.1:3999/employees?q=Empleado%201,phase=ramp&page=/employees&kind=page,",
  "checks,1795115428110,0.000000,signed in,,,,,,,,other_tenants_load-c,,,,,,,",
];
const csv = (rows: string[], header = CSV_HEADER) => gzipSync(`${header}\n${rows.join("\n")}\n`);
/** The summary export of the run CSV_ROWS comes from: one steady-state page, 11.803474 ms. */
const CSV_SUMMARY = { metrics: { "http_req_duration{kind:page,phase:steady}": { avg: 11.803474, "p(95)": 11.803474, max: 11.803474 } } };
const pageRow = (ms: number, phase = "steady") =>
  `http_req_duration,1795115432118,${ms.toFixed(6)},,,,true,,GET,http://127.0.0.1:3999/profile,HTTP/1.1,one_tenant,,200,,,http://127.0.0.1:3999/profile,page=/profile&kind=page&phase=${phase},`;

describe("5. per-request durations (D54)", () => {
  it("reads the metric, time, value and tags of each CSV row, by column name", () => {
    const rows = readCsvRows(csv(CSV_ROWS));
    expect(rows).toHaveLength(6);
    expect(rows[3]).toEqual({ metric: "http_req_duration", time: 1795115432118, value: 11.803474, tags: { page: "/profile", kind: "page", phase: "steady" } });
    expect(rows[5].tags).toEqual({});
    // Columns are found by name, wherever k6 puts them.
    const moved = CSV_HEADER.replace(",extra_tags,metadata", ",metadata,extra_tags");
    const swapped = CSV_ROWS[3].replace(/,(page=[^,]*),$/, ",,$1");
    expect(readCsvRows(csv([swapped], moved))[0].tags).toEqual({ page: "/profile", kind: "page", phase: "steady" });
  });

  it("fails on a row it cannot read instead of guessing", () => {
    expect(() => readCsvRows(gzipSync(""))).toThrow("the k6 CSV is empty");
    expect(() => readCsvRows(gzipSync("metric_name,value\nx,1\n"))).toThrow('no "timestamp" column');
    expect(() => readCsvRows(csv([`${CSV_ROWS[3]},extra`]))).toThrow("k6 CSV row 2 has 20 cells, the header 19");
    expect(() => readCsvRows(csv([CSV_ROWS[3].replace("1795115432118", "")]))).toThrow('row 2: timestamp "" is not a number');
    expect(() => readCsvRows(csv([CSV_ROWS[3].replace("11.803474", "abc")]))).toThrow('row 2: metric_value "abc" is not a number');
    expect(() => firstRequestMs(readCsvRows(csv([CSV_ROWS[5]])))).toThrow("no http_reqs rows");
  });

  it("counts the duration rows and the steady-state pages, and checks them against the summary", () => {
    expect(requestsLine(readCsvRows(csv(CSV_ROWS)), "first", "requests-first.csv.gz", CSV_SUMMARY)).toBe(
      "D36-diag: requests pass=first artifact=requests-first.csv.gz http_req_duration_rows=3 page_steady_rows=1 page_p95_steady_ms=11.80 matches_summary=yes",
    );
  });

  it("computes percentiles the way k6 does (linear between the closest ranks)", () => {
    expect(percentile([1, 2, 3, 4], 0.95)).toBeCloseTo(3.85, 10);
    expect(percentile([5], 0.95)).toBe(5);
    // With 841 values the rank is exact (840 × 0.95 = 798): no interpolation.
    expect(percentile(Array.from({ length: 841 }, (_, i) => i), 0.95)).toBe(798);
    expect(() => percentile([], 0.95)).toThrow("no values");
  });

  it("keeps only steady-state pages: no ramp page and no sign-in, even one tagged steady", () => {
    const rows = readCsvRows(csv([pageRow(10), pageRow(20), pageRow(900, "ramp"), CSV_ROWS[1]]));
    expect(rows[3].tags).toEqual({ phase: "steady", kind: "auth" });
    expect(pageSteadyStats(rows)).toEqual({ count: 2, p95: 19.5, avg: 15, max: 20 });
  });

  it("fails when the CSV is not the sample the summary measured", () => {
    const rows = readCsvRows(csv(CSV_ROWS));
    const other = { metrics: { "http_req_duration{kind:page,phase:steady}": { avg: 11.803474, "p(95)": 12.5, max: 11.803474 } } };
    expect(() => requestsLine(rows, "first", "requests-first.csv.gz", other)).toThrow("steady-state page p95 (11.803474) is not the summary's (12.5)");
    expect(() => requestsLine(rows, "first", "requests-first.csv.gz", { metrics: {} })).toThrow("the summary has no steady-state page p95");
    expect(() => requestsLine(readCsvRows(csv([CSV_ROWS[0]])), "first", "x", CSV_SUMMARY)).toThrow("no steady-state page durations");
  });

  it("is written by the D36 run and the second pass, each to its own file", () => {
    expect(runLine(stepNamed(D36_STEP))).toBe(
      'run: npm run load:test -- --out "csv=fileName=/out/requests-first.csv.gz,timeFormat=unix_milli"',
    );
    expect(runBlock(stepNamed(SECOND_STEP))).toContain('--out "csv=fileName=/out/requests-second.csv.gz,timeFormat=unix_milli"');
  });

  it("uploads an explicit list of files from the hidden load/.out, never accounts.json or the whole folder", () => {
    const step = stepNamed(ARTIFACT_STEP);
    expect(step).toContain("uses: actions/upload-artifact@v7");
    expect(step).toContain("if: always() && hashFiles('load/.out/requests-first.csv.gz') != ''");
    expect(step).toContain("include-hidden-files: true");
    expect(step).toContain("if-no-files-found: error");
    expect(step).toContain("name: d36-diag-attempt-${{ github.run_attempt }}");
    const paths = step
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("load/"));
    expect(paths).toEqual([
      "load/.out/summary.json",
      "load/.out/summary-second.json",
      "load/.out/requests-first.csv.gz",
      "load/.out/requests-second.csv.gz",
      "load/.out/second-pass.txt",
      "load/.out/standalone-files.txt",
    ]);
    expect(step).not.toContain("accounts");
    expect(step).not.toMatch(/load\/\.out\/?\s*$|\*/m);
  });
});

describe("6. the second k6 pass is never part of D36 (D54)", () => {
  it("reports its p95, failures, checks, tenant isolation and cost, and says it does not count", () => {
    expect(secondPassLine(summary(), "0", "92")).toEqual({
      line: "D36-diag: second pass p95_steady_ms=51.95 failed=0/1230 checks_failed=0/2385 tenant_isolation_failed=0 k6_exit=0 seconds=92 counts_for_d36=no",
      isolationFailures: 0,
    });
  });

  it("reports a crossed threshold (k6 exit 99) instead of failing", () => {
    expect(secondPassExit("99")).toBe(99);
    expect(secondPassLine(summary({ checkFails: 30 }), "99", "95").line).toContain("checks_failed=30/2385 tenant_isolation_failed=0 k6_exit=99");
  });

  it("fails on any other exit code, before it reads a summary that may not exist", () => {
    expect(() => secondPassExit("107")).toThrow("the second k6 pass failed with exit code 107");
    expect(() => secondPassExit("")).toThrow("is not a number");
    const result = spawnSync("node", [DIAG, "second-pass", "/nonexistent/summary-second.json", "107", "90"], { encoding: "utf-8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("exit code 107");
    expect(() => secondPassLine({ metrics: {} }, "0", "90")).toThrow("no steady-state page p95");
    expect(() => secondPassLine(summary(), "0", "ninety")).toThrow("is not a number of seconds");
    const noIsolation = { ...summary(), root_group: { checks: {} } };
    expect(() => secondPassLine(noIsolation, "0", "90")).toThrow(`no "no other tenant's employees" check`);
  });

  it("fails when a page of the second pass showed another tenant's employees, even under the 1 % threshold", () => {
    const dir = tempDir("d36-isolation-");
    const file = path.join(dir, "summary-second.json");
    writeFileSync(file, JSON.stringify(summary({ isolationFails: 2, checkFails: 2 })));
    const result = spawnSync("node", [DIAG, "second-pass", file, "0", "92"], { encoding: "utf-8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("tenant_isolation_failed=2");
    expect(result.stderr).toContain("2 page(s) of the second pass showed another tenant's employees");
  });

  it("shows the tail of a broken run's output, indented and without k6's steady-state page lines", () => {
    const output = [
      "seeded load-big: 60 employees",
      "    http_req_duration{kind:page,phase:steady}",
      "    ✓ 'p(95)<500' p(95)=51.95ms",
      "::warning::not a command once indented",
      "ERRO[0001] setup failed",
      "",
    ].join("\n");
    expect(outputTail(output)).toBe("  seeded load-big: 60 employees\n  ::warning::not a command once indented\n  ERRO[0001] setup failed");
    const dir = tempDir("d36-second-");
    const file = path.join(dir, "second-pass.txt");
    writeFileSync(file, output);
    const result = spawnSync("node", [DIAG, "second-pass", path.join(dir, "missing.json"), "107", "90", file], { encoding: "utf-8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("  ERRO[0001] setup failed");
    expect(result.stderr).not.toMatch(/phase:steady|p\(95\)/);
    expect(result.stderr).not.toMatch(/^::warning::/m);
  });

  it("runs after the D36 run, with its own summary file and its output in a file, not in the log", () => {
    const names = dockerSteps().map(stepName);
    expect(names.indexOf(DIAG_STEP)).toBe(names.indexOf(D36_STEP) + 1);
    expect(names.indexOf(SECOND_STEP)).toBe(names.indexOf(DIAG_STEP) + 1);
    expect(names.indexOf(ARTIFACT_STEP)).toBe(names.indexOf(SECOND_STEP) + 1);
    expect(names.indexOf(ISOLATION_STEP)).toBe(names.indexOf(ARTIFACT_STEP) + 1);
    const run = runBlock(stepNamed(SECOND_STEP));
    expect(run).toContain(
      'LOAD_SUMMARY=summary-second.json npm run load:test -- --out "csv=fileName=/out/requests-second.csv.gz,timeFormat=unix_milli" > load/.out/second-pass.txt 2>&1 || code=$?',
    );
    expect(run).toContain(
      'node scripts/d36-diag.mjs second-pass load/.out/summary-second.json "$code" "$(( $(date +%s) - start ))" load/.out/second-pass.txt || status=1',
    );
    expect(run).toContain("requests load/.out/requests-second.csv.gz second load/.out/summary-second.json");
  });

  it("uses the same k6 settings as the D36 run", () => {
    expect(envBlock(stepNamed(SECOND_STEP))).toEqual(envBlock(stepNamed(D36_STEP)));
  });

  it("leaves the D36 run the only k6 run whose summary reaches the log, and its summary.json the first pass's", () => {
    // The p95 that D36 reads is the `{ kind:page,phase:steady }` line of this step's log.
    const d36 = stepNamed(D36_STEP);
    expect(d36).not.toContain("LOAD_SUMMARY");
    expect(d36).not.toMatch(/>\s*\S/);
    const otherRuns = dockerSteps().filter((step) => step.includes("npm run load:test") && step !== d36);
    expect(otherRuns).toEqual([stepNamed(SECOND_STEP)]);
    for (const line of runBlock(otherRuns[0]).split("\n").filter((l) => l.includes("npm run load:test"))) {
      expect(line).toMatch(/> load\/\.out\/second-pass\.txt 2>&1/);
      expect(line).toMatch(/LOAD_SUMMARY=(?!summary\.json)[\w-]+\.json/);
    }
    // The diagnostics of the first pass read the first pass's files, and its CSV
    // must reproduce that summary's steady-state page p95 (matches_summary).
    const diag = runBlock(stepNamed(DIAG_STEP));
    expect(diag).toContain("sign-ins load/.out/summary.json first");
    expect(diag).toContain("requests load/.out/requests-first.csv.gz first load/.out/summary.json");
  });

  it("is estimated under 120 s from its settings (the D36 step took 92 s on main 6a33b6a); CI measures it", () => {
    // k6's own time: RAMP 20 s + HOLD 40 s + 20 s ramp-down + up to 10 s graceful stop.
    // The seed and k6's start add about 6 s on top; only CI measures the real cost.
    const env = envBlock(stepNamed(SECOND_STEP));
    const seconds = (value: string) => Number(value.replace(/s$/, ""));
    expect(seconds(env.RAMP) + seconds(env.HOLD) + 20 + 10).toBeLessThan(120);
  });
});

describe("the diagnostic steps never fail the job, and run when the D36 run failed (D54)", () => {
  it("lets the k6 run itself fail the job as before", () => {
    expect(stepNamed(D36_STEP)).not.toMatch(/^\s+(if|continue-on-error):/m);
  });

  it.each([HEALTHY_STEP, DIAG_STEP, SECOND_STEP, ARTIFACT_STEP])("%s continues on error", (name) => {
    expect(stepNamed(name)).toMatch(/^ {8}continue-on-error: true$/m);
  });

  it("fails the job, in a step of its own, only on a page of the second pass that showed another tenant's employees", () => {
    const step = stepNamed(ISOLATION_STEP);
    expect(step).not.toContain("continue-on-error");
    expect(step).toContain("if: ${{ !cancelled() && steps.second_pass.outcome != '' && steps.second_pass.outcome != 'skipped' }}");
    expect(step).toContain("FAILED: ${{ steps.second_pass.outputs.tenant_isolation_failed }}");
    expect(stepNamed(SECOND_STEP)).toMatch(/^ {8}id: second_pass$/m);
    const ok = runStep(ISOLATION_STEP, {}, { FAILED: "0" });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe("No page of the second k6 pass showed another tenant's employees.\n");
    const leak = runStep(ISOLATION_STEP, {}, { FAILED: "2" });
    expect(leak.status).toBe(1);
    expect(leak.stdout).toContain("::error::D36-diag: 2 page(s) of the second k6 pass showed another tenant's employees");
    // No count (the second pass crashed before its summary): a visible warning, not a silent skip.
    const unknown = runStep(ISOLATION_STEP, {}, { FAILED: "" });
    expect(unknown.status).toBe(0);
    expect(unknown.stdout).toContain(
      "::warning::D36-diag: the second k6 pass left no tenant-isolation count (see its step), so this step cannot check it; the D56 ratio step fails the job without it",
    );
    // The first pass has its own isolation threshold now: ci.yml no longer says it tolerates 1 %.
    expect(CI).not.toContain("tolerates up to 1 %");
  });

  it.each([DIAG_STEP, SECOND_STEP])("%s runs whenever the D36 run left its summary", (name) => {
    expect(stepNamed(name)).toContain("if: ${{ !cancelled() && hashFiles('load/.out/summary.json') != '' }}");
  });
});

/**
 * Runs a step's `run:` block as GitHub does (bash -e), in a temp checkout with
 * the two scripts, with fake commands first on PATH and the given files.
 */
function runStep(name: string, fakes: Record<string, string>, env: Record<string, string> = {}, files: Record<string, string | Buffer> = {}) {
  const work = tempDir("d36-step-");
  mkdirSync(path.join(work, "scripts"));
  for (const file of [DIAG, FILES]) copyFileSync(file, path.join(work, "scripts", path.basename(file)));
  mkdirSync(path.join(work, "load/.out"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) writeFileSync(path.join(work, rel), content);
  const bin = path.join(work, "bin");
  mkdirSync(bin);
  for (const [command, body] of Object.entries(fakes)) writeFileSync(path.join(bin, command), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  const stepSummary = path.join(work, "step-summary.md");
  const githubEnv = path.join(work, "github-env");
  const githubOutput = path.join(work, "github-output");
  const step = stepNamed(name);
  writeFileSync(path.join(work, "step.sh"), step.includes("run: |") ? runBlock(step) : runLine(step).slice("run: ".length));
  const result = spawnSync("bash", ["-e", "step.sh"], {
    cwd: work,
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_STEP_SUMMARY: stepSummary,
      GITHUB_ENV: githubEnv,
      GITHUB_OUTPUT: githubOutput,
      ...env,
    },
  });
  const read = (file: string) => {
    try {
      return readFileSync(file, "utf-8");
    } catch {
      return "";
    }
  };
  return { ...result, work, stepSummary: read(stepSummary), githubEnv: read(githubEnv), githubOutput: read(githubOutput) };
}

const DOCKER_RUN =
  "run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint node -v $PWD/scripts/d36-standalone-files.mjs:/d36/standalone-files.mjs:ro sha256:1234 /d36/standalone-files.mjs /app";

describe("the new steps, run as ci.yml writes them (D54)", () => {
  it("records when the web container turned healthy for the later steps", () => {
    const health = JSON.stringify({ Status: "healthy", Log: [probe("2026-11-19T18:49:58Z", 1), probe("2026-11-19T18:50:08.5Z", 0)] });
    const result = runStep(HEALTHY_STEP, { docker: `[ "$*" = "inspect -f {{json .State.Health}} scaliahr-web-1" ] || exit 9\necho '${health}'` });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("scaliahr-web-1 turned healthy at 2026-11-19T18:50:08.500Z\n");
    expect(result.githubEnv).toBe("D36_WEB_HEALTHY_AT=2026-11-19T18:50:08.500Z\nD36_WEB_HEALTHY_EXACT=true\n");
  });

  const healthyEnv = { D36_WEB_HEALTHY_AT: "2026-11-19T19:06:18.992Z", D36_WEB_HEALTHY_EXACT: "true", GITHUB_RUN_ATTEMPT: "1" };
  const firstPassFiles = () => ({
    "load/.out/summary.json": JSON.stringify({ metrics: { ...summary({ ramp: 71, steady: 4 }).metrics, ...CSV_SUMMARY.metrics } }),
    "load/.out/requests-first.csv.gz": csv(CSV_ROWS),
  });
  // Only the two expected commands are answered; the run reaches the hashing script, on a fixture tree.
  const fakeDocker = (tree: string) =>
    [
      'case "$*" in',
      '  "inspect -f {{.Image}} scaliahr-web-1") echo sha256:1234 ;;',
      `  "${DOCKER_RUN}") exec node scripts/d36-standalone-files.mjs "${tree}" ;;`,
      '  *) echo "unexpected: docker $*" >&2; exit 9 ;;',
      "esac",
    ].join("\n");

  it("prints the first pass's diagnostics, one D36-diag line per point", () => {
    const result = runStep(DIAG_STEP, { docker: fakeDocker(standaloneTree(BUILD_A)) }, healthyEnv, firstPassFiles());
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines.map((line) => TOPICS.find((topic: string) => line.startsWith(`D36-diag: ${topic} `)))).toEqual([
      "runner",
      "healthy to k6",
      "sign-ins",
      "requests",
      "standalone",
    ]);
    for (const line of lines) expect(line).toMatch(DIAG_LINE);
    expect(lines[0]).toMatch(/ run_attempt=1$/);
    expect(lines[1]).toBe(
      "D36-diag: healthy to k6 seconds=249.1 web_healthy_at=2026-11-19T19:06:18.992Z k6_first_request_at=2026-11-19T19:10:28.109Z exact=yes",
    );
    expect(lines[2]).toBe("D36-diag: sign-ins pass=first ramp=71 steady=4 retries_ramp=0 retries_steady=0");
    expect(lines[3]).toContain("matches_summary=yes");
    expect(lines[4]).toContain(" files=8 ");
    expect(result.stepSummary.match(/` D36-diag: /g)).toHaveLength(5);
  });

  it("keeps going after one command fails, and fails the step at the end", () => {
    const env = { ...healthyEnv };
    delete (env as Record<string, string>).D36_WEB_HEALTHY_AT;
    const result = runStep(DIAG_STEP, { docker: fakeDocker(standaloneTree(BUILD_A)) }, { ...env, D36_WEB_HEALTHY_AT: "" }, firstPassFiles());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("::error::D36-diag: D36_WEB_HEALTHY_AT is not set");
    // The other four lines are still there.
    expect(result.stdout.match(/^D36-diag: /gm)).toHaveLength(4);
    expect(result.stdout).toContain("D36-diag: standalone ");
  });

  it("fails loudly when the image cannot be listed, still prints the other lines, and leaves no partial list", () => {
    for (const docker of ["exit 9", 'case "$1" in inspect) echo sha256:1234 ;; run) echo "${"0".repeat(64)}  partial"; exit 1 ;; esac']) {
      const result = runStep(DIAG_STEP, { docker }, healthyEnv, firstPassFiles());
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("::error::D36-diag: could not list the web image's standalone files");
      expect(result.stdout.match(/^D36-diag: /gm)).toHaveLength(4);
      expect(() => readFileSync(path.join(result.work, "load/.out/standalone-files.txt"))).toThrow("ENOENT");
    }
  });

  it.each([
    [0, 0],
    [99, 0],
    [107, 1],
    [1, 1],
  ])("second pass: k6 exit %i ends the step with %i, and its steady line never reaches the log", (k6Exit, stepExit) => {
    const fixture = tempDir("d36-fixture-");
    writeFileSync(path.join(fixture, "summary-second.json"), JSON.stringify({ ...summary({ ramp: 71, steady: 4 }), metrics: { ...summary({ ramp: 71, steady: 4 }).metrics, ...CSV_SUMMARY.metrics } }));
    writeFileSync(path.join(fixture, "requests-second.csv.gz"), csv(CSV_ROWS));
    const npm = [
      `printf '%s\\n' "LOAD_SUMMARY=$LOAD_SUMMARY RAMP=$RAMP HOLD=$HOLD $*" > load/.out/npm-call.txt`,
      'echo "      { kind:page,phase:steady }...: avg=1ms p(95)=999.99ms"',
      'echo "ERRO[0001] something broke"',
      `[ "${k6Exit}" = 1 ] || cp "${fixture}"/summary-second.json "${fixture}"/requests-second.csv.gz load/.out/`,
      `exit ${k6Exit}`,
    ].join("\n");
    const result = runStep(SECOND_STEP, { npm }, envBlock(stepNamed(SECOND_STEP)));
    expect(result.status, result.stderr).toBe(stepExit);
    expect(readFileSync(path.join(result.work, "load/.out/npm-call.txt"), "utf-8")).toBe(
      "LOAD_SUMMARY=summary-second.json RAMP=20s HOLD=40s run load:test -- --out csv=fileName=/out/requests-second.csv.gz,timeFormat=unix_milli\n",
    );
    // The fake k6 printed a steady line: it is in second-pass.txt, never in the step's output or summary.
    expect(readFileSync(path.join(result.work, "load/.out/second-pass.txt"), "utf-8")).toContain("kind:page,phase:steady");
    for (const text of [result.stdout, result.stderr, result.stepSummary]) expect(text).not.toMatch(/kind:page,phase:steady|p\(95\)=999/);
    if (stepExit === 0) {
      expect(result.githubOutput).toBe("tenant_isolation_failed=0\n");
      expect(result.stdout).toContain(`D36-diag: second pass p95_steady_ms=11.80 failed=0/1230 checks_failed=0/2385 tenant_isolation_failed=0 k6_exit=${k6Exit} seconds=`);
      expect(result.stdout).toContain("counts_for_d36=no");
      expect(result.stdout).toContain("D36-diag: sign-ins pass=second ramp=71 steady=4");
      expect(result.stdout).toContain("D36-diag: requests pass=second artifact=requests-second.csv.gz");
    } else {
      // A broken run that still wrote its summary passes its isolation count on; one that wrote none, nothing.
      expect(result.githubOutput).toBe(k6Exit === 1 ? "" : "tenant_isolation_failed=0\n");
      expect(result.stderr).toContain(`the second k6 pass failed with exit code ${k6Exit}`);
      expect(result.stderr).toContain("  ERRO[0001] something broke");
    }
  });

  it("second pass: the isolation count reaches the gate even when the rest of the summary cannot be read", () => {
    const dir = tempDir("d36-partial-");
    const file = path.join(dir, "summary-second.json");
    const partial = summary({ isolationFails: 3 });
    delete (partial.metrics as Record<string, unknown>)["http_req_duration{kind:page,phase:steady}"];
    writeFileSync(file, JSON.stringify(partial));
    const output = path.join(dir, "github-output");
    for (const code of ["0", "107"]) {
      writeFileSync(output, "");
      const result = spawnSync("node", [DIAG, "second-pass", file, code, "90"], { encoding: "utf-8", env: { ...process.env, GITHUB_OUTPUT: output } });
      expect(result.status).toBe(1);
      expect(readFileSync(output, "utf-8")).toBe("tenant_isolation_failed=3\n");
    }
  });

  it("second pass: a tenant-isolation failure is passed on to the gate step, and the other lines still print", () => {
    const fixture = tempDir("d36-fixture-");
    const leaking = summary({ ramp: 71, steady: 4, isolationFails: 2, checkFails: 2 });
    writeFileSync(path.join(fixture, "summary-second.json"), JSON.stringify({ ...leaking, metrics: { ...leaking.metrics, ...CSV_SUMMARY.metrics } }));
    writeFileSync(path.join(fixture, "requests-second.csv.gz"), csv(CSV_ROWS));
    const npm = `cp "${fixture}"/summary-second.json "${fixture}"/requests-second.csv.gz load/.out/`;
    const result = runStep(SECOND_STEP, { npm }, envBlock(stepNamed(SECOND_STEP)));
    expect(result.status).toBe(1);
    expect(result.githubOutput).toBe("tenant_isolation_failed=2\n");
    expect(result.stderr).toContain("2 page(s) of the second pass showed another tenant's employees");
    expect(result.stdout).toContain("tenant_isolation_failed=2");
    expect(result.stdout).toContain("D36-diag: sign-ins pass=second ramp=71 steady=4");
    expect(result.stdout).toContain("D36-diag: requests pass=second ");
  });
});

describe("scripts/load-test.sh: LOAD_SUMMARY (D54)", () => {
  it.each(["../summary.json", "summary", "a b.json", "/tmp/summary.json"])("rejects %j before doing anything", (value) => {
    const result = spawnSync("bash", [LOAD_TEST], { encoding: "utf-8", env: { ...process.env, LOAD_SUMMARY: value } });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::LOAD_SUMMARY must be a file name like summary.json");
  });

  /** Runs load-test.sh in a temp repo with fake supabase, curl, node and docker that record their arguments. */
  function runLoadTest(env: Record<string, string>, args: string[] = []) {
    const repo = tempDir("d36-loadtest-");
    mkdirSync(path.join(repo, "scripts"));
    mkdirSync(path.join(repo, "load"));
    copyFileSync(LOAD_TEST, path.join(repo, "scripts/load-test.sh"));
    writeFileSync(path.join(repo, "load/pages.js"), "");
    const bin = path.join(repo, "bin");
    mkdirSync(bin);
    const fake = (name: string, body: string) => writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
    fake("supabase", "printf 'DB_URL=\"postgresql://x\"\\nAPI_URL=\"http://127.0.0.1:54321\"\\nANON_KEY=\"anon\"\\nSERVICE_ROLE_KEY=\"service\"\\n'");
    fake("curl", "exit 0");
    fake("node", 'echo "node $*" >> "$CALLS"');
    fake("docker", 'printf "%s\\n" "$@" > "$CALLS.docker"');
    const calls = path.join(repo, "calls");
    const result = spawnSync("bash", [path.join(repo, "scripts/load-test.sh"), ...args], {
      encoding: "utf-8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: calls, ...env },
    });
    return { ...result, docker: readFileSync(`${calls}.docker`, "utf-8").split("\n").filter(Boolean) };
  }

  it("exports the summary to /out/summary.json by default, the file the D36 run writes", () => {
    const { status, docker } = runLoadTest({}, ["--out", "csv=fileName=/out/requests-first.csv.gz"]);
    expect(status).toBe(0);
    expect(docker.slice(-5)).toEqual(["--summary-export", "/out/summary.json", "--out", "csv=fileName=/out/requests-first.csv.gz", "/load/pages.js"]);
  });

  it("exports it to another file with LOAD_SUMMARY, and passes extra arguments to k6 before the script", () => {
    const { status, docker } = runLoadTest({ LOAD_SUMMARY: "summary-second.json" }, ["--out", "csv=fileName=/out/requests-second.csv.gz"]);
    expect(status).toBe(0);
    expect(docker.slice(-5)).toEqual(["--summary-export", "/out/summary-second.json", "--out", "csv=fileName=/out/requests-second.csv.gz", "/load/pages.js"]);
  });
});

// load/pages.js runs in k6, not Node: its imports are replaced by stubs that
// record every request, check, sleep and counter.
interface Recorded {
  requests: { method: string; url: string; params: Record<string, unknown>; tags: Record<string, string> }[];
  sleeps: number[];
  counters: { name: string; value: number; tags: Record<string, string> }[];
  /** One sample of the `checks` metric per check, tagged with its name, as k6 does. */
  checks: { passed: boolean; tags: Record<string, string> }[];
}
/** `pageBodies`: the bodies of the first pages, in order; later pages get an empty page. */
function loadPages({ authStatus = 200, ramp = "20s", pageBodies = [] }: { authStatus?: number; ramp?: string; pageBodies?: string[] } = {}) {
  const recorded: Recorded = { requests: [], sleeps: [], counters: [], checks: [] };
  const bodies = [...pageBodies];
  const clock = { ms: 0 };
  const stubs = {
    "k6/http": {
      default: {
        post: (url: string, _body: string, params: { tags: Record<string, string> }) => {
          recorded.requests.push({ method: "POST", url, params, tags: params.tags });
          return { status: authStatus, json: () => ({ access_token: "a.b.c" }) };
        },
        get: (url: string, params: { tags: Record<string, string> }) => {
          recorded.requests.push({ method: "GET", url, params, tags: params.tags });
          return { status: 200, body: bodies.shift() ?? "<html></html>" };
        },
        cookieJar: () => ({ set: () => undefined }),
      },
    },
    "k6/encoding": { default: { b64encode: (text: string) => Buffer.from(text).toString("base64url") } },
    "k6/execution": {
      default: {
        vu: { idInTest: 1 },
        instance: {
          get currentTestRunDuration() {
            return clock.ms;
          },
        },
      },
    },
    k6: {
      // k6 runs every check of the call (no short-circuit) and records each one.
      check: (res: unknown, checks: Record<string, (r: unknown) => boolean>) => {
        const results = Object.entries(checks).map(([name, fn]) => ({ passed: fn(res), tags: { check: name } }));
        recorded.checks.push(...results);
        return results.every((result) => result.passed);
      },
      sleep: (seconds: number) => recorded.sleeps.push(seconds),
    },
    "k6/data": { SharedArray: function SharedArray(_name: string, make: () => unknown[]) { return make(); } },
    "k6/metrics": {
      Counter: class {
        constructor(private readonly name: string) {}
        add(value: number, tags: Record<string, string>) {
          recorded.counters.push({ name: this.name, value, tags });
        }
      },
    },
  };
  let source = PAGES.replace(/^import (\w+) from "([^"]+)";$/gm, 'const $1 = __k6["$2"].default;')
    .replace(/^import \{ ([^}]+) \} from "([^"]+)";$/gm, 'const { $1 } = __k6["$2"];')
    .replace(/^export const options =/m, "const options =")
    .replace(/^export default function \(\) \{/m, "function __iteration() {");
  expect(source).not.toMatch(/^\s*(import|export)\b/m);
  // k6 runs modules in strict mode; so does this copy.
  source = `"use strict";\n${source}\nreturn { options, iteration: __iteration };`;
  const accounts = JSON.stringify({ password: "p", accounts: [{ email: "a@load.test", tenant: "load-big", tag: "LoadGrande" }] });
  const env = { RAMP: ramp, HOLD: "40s", TENANT: "load-big", THINK_MIN: "2", THINK_MAX: "6" };
  const script = new Function("__k6", "__ENV", "open", source)(stubs, env, () => accounts) as {
    options: { thresholds: Record<string, string[]>; scenarios: Record<string, { stages: unknown[] }> };
    iteration: () => void;
  };
  return { ...script, recorded, clock };
}

/** Whether k6 puts a sample with these tags in the submetric of this selector, e.g. {kind:page,phase:steady}. */
const inSubmetric = (selector: Record<string, string>, tags: Record<string, string>) =>
  Object.entries(selector).every(([key, value]) => tags[key] === value);

const PAGE_PATHS = ["/dashboard", "/employees", "/employees?page=2", "/employees?q=Empleado%201", "/org-chart", "/performance", "/skills-hub", "/profile"];

describe("load/pages.js: the sign-in phase tag leaves the page p95 alone (D54)", () => {
  it("keeps the page thresholds, and adds listing thresholds on sign-ins and retries and the isolation check's own threshold", () => {
    const { options } = loadPages();
    expect(options.thresholds).toEqual({
      "http_req_duration{kind:page,phase:steady}": ["p(95)<500"],
      "http_req_duration{kind:page,phase:ramp}": ["max>=0"],
      "http_req_failed{kind:page}": ["rate<0.01"],
      checks: ["rate>0.99"],
      "checks{check:no other tenant's employees}": ["rate==1"],
      "http_reqs{kind:auth,phase:ramp}": ["count>=0"],
      "http_reqs{kind:auth,phase:steady}": ["count>=0"],
      "sign_in_retries{phase:ramp}": ["count>=0"],
      "sign_in_retries{phase:steady}": ["count>=0"],
    });
    expect(options.scenarios.one_tenant.stages).toEqual([
      { duration: "20s", target: 1000 },
      { duration: "40s", target: 1000 },
      { duration: "20s", target: 0 },
    ]);
  });

  it("opens a page with exactly its old parameters: no redirects, and the tags kind, page and phase, the phase changing at RAMP", () => {
    for (const [ms, phase] of [
      [19_999, "ramp"],
      [20_000, "steady"],
    ] as const) {
      const { iteration, recorded, clock } = loadPages();
      clock.ms = ms;
      iteration();
      const page = recorded.requests.find((request) => request.method === "GET");
      const pagePath = page?.url.slice("http://localhost:3000".length) ?? "";
      expect(PAGE_PATHS).toContain(pagePath);
      expect(page?.params).toEqual({ redirects: 0, tags: { kind: "page", page: pagePath.split("?")[0], phase } });
    }
  });

  it("tags a sign-in with kind auth and its phase", () => {
    const { iteration, recorded, clock } = loadPages();
    clock.ms = 20_000;
    iteration();
    expect(recorded.requests[0]).toMatchObject({ method: "POST", tags: { kind: "auth", phase: "steady" } });
    expect(recorded.counters).toEqual([]);
  });

  it("counts a failed sign-in as a retry in its phase, sleeps 5 s and opens no page", () => {
    const { iteration, recorded, clock } = loadPages({ authStatus: 400 });
    clock.ms = 3_000;
    iteration();
    clock.ms = 25_000;
    iteration();
    expect(recorded.requests.map((request) => request.method)).toEqual(["POST", "POST"]);
    expect(recorded.counters).toEqual([
      { name: "sign_in_retries", value: 1, tags: { phase: "ramp" } },
      { name: "sign_in_retries", value: 1, tags: { phase: "steady" } },
    ]);
    expect(recorded.sleeps).toEqual([5, 5]);
  });

  it("puts no sign-in in the submetric D36 reads, with or without its phase tag", () => {
    const { iteration, recorded, clock } = loadPages();
    for (const ms of [0, 5_000, 19_999, 20_000, 30_000, 59_000]) {
      clock.ms = ms;
      iteration();
    }
    const steady = { kind: "page", phase: "steady" };
    const selected = recorded.requests.filter((request) => inSubmetric(steady, request.tags));
    const withoutAuthPhase = recorded.requests
      .map((request) => (request.tags.kind === "auth" ? { ...request, tags: { kind: "auth" } } : request))
      .filter((request) => inSubmetric(steady, request.tags));
    expect(selected).toHaveLength(3);
    expect(selected.every((request) => request.method === "GET")).toBe(true);
    expect(selected).toEqual(withoutAuthPhase);
  });
});

/** A threshold key as k6 v1.8.2 reads it: `metric{key:value,…}`, each key and value trimmed of spaces and quotes. */
function parseThresholdKey(key: string): { metric: string; selector: Record<string, string> } {
  const open = key.indexOf("{");
  if (open === -1) return { metric: key, selector: {} };
  if (!key.endsWith("}")) throw new Error(`"${key}" opens a submetric it does not close`);
  const trim = (text: string) => text.trim().replace(/^["']+|["']+$/g, "");
  const pairs = key
    .slice(open + 1, -1)
    .split(",")
    .filter(Boolean)
    .map((pair) => {
      const [name, ...value] = pair.split(":");
      return [trim(name), trim(value.join(":"))] as const;
    });
  return { metric: key.slice(0, open), selector: Object.fromEntries(pairs) };
}

/**
 * Whether these Rate samples hold `rate>N` or `rate==N`, the two forms load/pages.js uses
 * on checks. `null` with no sample: k6 v1.8.2 does not evaluate a submetric without samples.
 */
function rateHolds(expression: string, passed: boolean[]): boolean | null {
  const match = /^rate(>|==)(\d+(?:\.\d+)?)$/.exec(expression);
  if (!match) throw new Error(`"${expression}" is not a rate threshold this test reads`);
  if (passed.length === 0) return null;
  const rate = passed.filter(Boolean).length / passed.length;
  return match[1] === ">" ? rate > Number(match[2]) : rate === Number(match[2]);
}

describe("load/pages.js: the isolation check has a threshold of its own, with no tolerance", () => {
  const ISOLATION_KEY = `checks{check:${ISOLATION_CHECK}}`;

  /** One VU (tenant load-big) that runs `iterations` iterations in steady state; see loadPages for the options. */
  function run(iterations: number, options: { authStatus?: number; pageBodies?: string[] } = {}) {
    const loaded = loadPages(options);
    loaded.clock.ms = 30_000;
    for (let i = 0; i < iterations; i++) loaded.iteration();
    const thresholds = Object.entries(loaded.options.thresholds)
      .filter(([key]) => parseThresholdKey(key).metric === "checks")
      .map(([key, expressions]) => {
        const { selector } = parseThresholdKey(key);
        const passed = loaded.recorded.checks.filter((sample) => inSubmetric(selector, sample.tags)).map((sample) => sample.passed);
        const results = expressions.map((expression) => rateHolds(expression, passed));
        return [key, { samples: passed.length, holds: results.includes(null) ? null : results.every(Boolean) }] as const;
      });
    return { ...loaded, thresholds: Object.fromEntries(thresholds) };
  }

  it("selects the isolation check's samples by the check's exact name", () => {
    // A name that matched no check would leave the submetric without samples,
    // and k6 v1.8.2 does not evaluate an empty submetric: it would pass unseen.
    expect(parseThresholdKey(ISOLATION_KEY)).toEqual({ metric: "checks", selector: { check: ISOLATION_CHECK } });
    const { thresholds } = run(10);
    expect(Object.keys(thresholds).sort()).toEqual(["checks", ISOLATION_KEY].sort());
    // One isolation sample per page; the general one also counts "page 200" and the sign-in.
    expect(thresholds[ISOLATION_KEY]).toEqual({ samples: 10, holds: true });
    expect(thresholds.checks).toEqual({ samples: 21, holds: true });
  });

  it.each(["LoadAlfa", "LoadBravo", "LoadCharlie"])(
    "fails on a single page with %s's employees, which the general threshold alone lets through",
    (tag) => {
      const { thresholds, recorded } = run(150, { pageBodies: [`<html>${tag}</html>`] });
      // 1 failed check of 301 is 99.67 % passed: over the general 99 %.
      expect(thresholds.checks).toEqual({ samples: 301, holds: true });
      expect(thresholds[ISOLATION_KEY]).toEqual({ samples: 150, holds: false });
      // The page is still one more sample of the submetric D36 reads, like any other.
      const steady = recorded.requests.filter((request) => inSubmetric({ kind: "page", phase: "steady" }, request.tags));
      expect(steady).toHaveLength(150);
    },
  );

  it("holds when no page shows another tenant's employees, the VU's own tenant included", () => {
    const { thresholds } = run(150, { pageBodies: ["<html>LoadGrande</html>"] });
    expect(thresholds.checks).toEqual({ samples: 301, holds: true });
    expect(thresholds[ISOLATION_KEY]).toEqual({ samples: 150, holds: true });
  });

  it("leaves the isolation submetric empty, so not evaluated, when every sign-in fails; the general threshold fails then", () => {
    const { thresholds, recorded } = run(5, { authStatus: 400 });
    expect(recorded.requests.every((request) => request.method === "POST")).toBe(true);
    expect(thresholds[ISOLATION_KEY]).toEqual({ samples: 0, holds: null });
    expect(thresholds.checks).toEqual({ samples: 5, holds: false });
  });
});

/** The docker job, split into its steps (each starts with "      - "). */
function dockerSteps(): string[] {
  const start = CI.indexOf("\n  docker:\n");
  if (start === -1) throw new Error("no docker job in ci.yml");
  const rest = CI.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  const job = next === -1 ? rest : rest.slice(0, next + 1);
  return job.split("\n      - ").slice(1);
}
const stepName = (step: string) => /name: (.+)/.exec(step)?.[1] ?? "";
function stepNamed(name: string): string {
  const step = dockerSteps().find((s) => stepName(s) === name);
  if (!step) throw new Error(`no step "${name}" in the docker job`);
  return step;
}
/** The step's `run: |` block, dedented. */
function runBlock(step: string): string {
  const lines = step.split("\n");
  const start = lines.findIndex((line) => line.trim() === "run: |");
  if (start === -1) throw new Error("the step has no `run: |` block");
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}
const runLine = (step: string) => step.split("\n").find((line) => line.trim().startsWith("run: "))?.trim() ?? "";
/** The step's `env:` block, as key/value pairs (quotes and comments dropped). */
function envBlock(step: string): Record<string, string> {
  const lines = step.split("\n");
  const start = lines.findIndex((line) => line.trim() === "env:");
  if (start === -1) throw new Error("the step has no env block");
  const env: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const match = /^ {10}([A-Z_]+): "?([^"]*)"?$/.exec(line);
    if (!match) break;
    env[match[1]] = match[2];
  }
  return env;
}
