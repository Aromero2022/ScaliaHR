import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  INITIAL_JS_BUDGET,
  buildRoutes,
  demoCredentialsInClientBundle,
  initialJs,
  initialJsGrowth,
  initialJsReport,
  isForbiddenRoute,
  parseArgs,
  testToolsInBuild,
} from "../../../../scripts/check-prod-build.mjs";

/**
 * D32: CI runs scripts/check-prod-build.mjs on the production build; it fails
 * on any debug or test route and on browser source maps (D29).
 */

const REPO = path.resolve(__dirname, "../../../..");
const SCRIPT = path.join(REPO, "scripts/check-prod-build.mjs");
const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function fakeBuild(
  appRoutes: Record<string, string>,
  pages: Record<string, string> = {},
  files: string[] = [],
  contents: Record<string, string> = {},
) {
  const dir = mkdtempSync(path.join(tmpdir(), "d32-next-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "server"), { recursive: true });
  writeFileSync(path.join(dir, "app-path-routes-manifest.json"), JSON.stringify(appRoutes));
  writeFileSync(path.join(dir, "server/pages-manifest.json"), JSON.stringify({ "/_app": "pages/_app.js", ...pages }));
  for (const file of [...files, ...Object.keys(contents)]) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), contents[file] ?? "");
  }
  return dir;
}

const run = (dir: string, ...args: string[]) => spawnSync("node", [SCRIPT, dir, ...args], { encoding: "utf-8" });
const gz = (text: string) => gzipSync(Buffer.from(text), { level: 9 }).length;

describe("check-prod-build (D32)", () => {
  it.each(["/debug", "/api/debug-session", "/test", "/admin/tests/[id]", "/dev/tools", "/e2e/login", "/__internal", "/api/seed", "/Playground", "/mock_api"])(
    "refuses %s",
    (route) => expect(isForbiddenRoute(route)).toBe(true),
  );

  it.each(["/", "/login", "/latest", "/contest", "/developers", "/employees/[id]", "/api/health", "/admin-center/manage-roles"])(
    "allows %s",
    (route) => expect(isForbiddenRoute(route)).toBe(false),
  );

  it("reads app and pages routes, leaving out Next.js internals", () => {
    const dir = fakeBuild({ "/page": "/", "/api/health/route": "/api/health" }, { "/old-page": "pages/old-page.js" });
    expect(buildRoutes(dir)).toEqual(["/", "/api/health", "/old-page"]);
  });

  it("passes a clean build", () => {
    const result = run(fakeBuild({ "/page": "/", "/login/page": "/login" }));
    expect(result.status).toBe(0);
  });

  it("fails on a debug route, a test page or a browser source map", () => {
    const routes = run(fakeBuild({ "/page": "/", "/api/debug/route": "/api/debug" }, { "/test": "pages/test.js" }));
    expect(routes.status).toBe(1);
    expect(routes.stderr).toContain("/api/debug");
    expect(routes.stderr).toContain("/test");

    const maps = run(fakeBuild({ "/page": "/" }, {}, ["static/chunks/app.js.map"]));
    expect(maps.status).toBe(1);
    expect(maps.stderr).toContain("static/chunks/app.js.map");
  });

  it("fails when the client bundle carries the demo password or email, and ignores the server build (D41)", () => {
    const leaky = fakeBuild({ "/page": "/" }, {}, [], {
      "static/chunks/app/login/page.js": 'children:"Demo: elena.martinez@acme.dev / Demo1234!"',
      "server/app/login/page.js": "Demo1234",
    });
    expect(demoCredentialsInClientBundle(leaky)).toEqual([
      "static/chunks/app/login/page.js: Demo1234",
      "static/chunks/app/login/page.js: elena.martinez@acme.dev",
    ]);
    const result = run(leaky);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("demo credential in the client bundle");

    const clean = fakeBuild({ "/page": "/" }, {}, [], { "static/chunks/app.js": "export const ok = 1;", "server/app/page.js": "Demo1234" });
    expect(demoCredentialsInClientBundle(clean)).toEqual([]);
    expect(run(clean).status).toBe(0);
  });

  it("fails when axe or Playwright reach the standalone server or the client bundle (D44)", () => {
    const leaky = fakeBuild({ "/page": "/" }, {}, [
      "standalone/node_modules/axe-core/package.json",
      "standalone/apps/web/node_modules/@playwright/test/package.json",
    ], {
      "static/chunks/app/page.js": "/*! axe v4.14.0 Copyright (c) 2015 - 2026 Deque Systems, Inc. */",
    });
    expect(testToolsInBuild(leaky)).toEqual([
      "standalone/apps/web/node_modules/@playwright",
      "standalone/node_modules/axe-core",
      "static/chunks/app/page.js: Deque Systems",
    ]);
    const result = run(leaky);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("e2e tooling in the production build");

    // Names that only contain "axe" or "playwright" are not the packages.
    const clean = fakeBuild({ "/page": "/" }, {}, [
      "standalone/node_modules/caniuse-lite/data/features/wasm-relaxed-simd.js",
      "standalone/apps/web/node_modules/next/dist/compiled/@next/font/dist/google/get-font-axes.js",
    ], { "static/chunks/app.js": "export const axes = 1;" });
    expect(testToolsInBuild(clean)).toEqual([]);
    expect(run(clean).status).toBe(0);
  });

  it("fails when there is no build", () => {
    expect(run(path.join(tmpdir(), "no-such-next-dir")).status).toBe(1);
  });
});

describe("initial JS of each page (D51)", () => {
  const files = {
    "static/chunks/root.js": "r".repeat(400),
    "static/chunks/shared.js": "s".repeat(300),
    "static/chunks/protected-layout.js": "p".repeat(200),
    "static/chunks/loading.js": "l".repeat(50),
    "static/chunks/dashboard.js": "d".repeat(100),
    "static/chunks/login.js": "g".repeat(80),
    "static/chunks/polyfills.js": "y".repeat(999),
    "static/css/app.css": "c".repeat(999),
  };
  const manifests = {
    "build-manifest.json": JSON.stringify({ rootMainFiles: ["static/chunks/root.js"], polyfillFiles: ["static/chunks/polyfills.js"] }),
    "app-build-manifest.json": JSON.stringify({
      pages: {
        "/layout": ["static/chunks/root.js", "static/css/app.css"],
        "/(protected)/layout": ["static/chunks/root.js", "static/chunks/shared.js", "static/chunks/protected-layout.js"],
        "/(protected)/loading": ["static/chunks/loading.js"],
        "/(protected)/dashboard/page": ["static/chunks/shared.js", "static/chunks/dashboard.js"],
        "/login/page": ["static/chunks/login.js"],
        "/api/health/route": ["static/chunks/root.js"],
      },
    }),
  };
  const build = () => fakeBuild({ "/(protected)/dashboard/page": "/dashboard", "/login/page": "/login" }, {}, [], { ...files, ...manifests });

  it("adds the page and every segment above it, each file once, without CSS, polyfills or route handlers", () => {
    const sizes = initialJs(build());
    expect(Object.keys(sizes ?? {}).sort()).toEqual(["/(protected)/dashboard", "/login"]);
    const f = (name: keyof typeof files) => gz(files[name]);
    expect(sizes?.["/(protected)/dashboard"]).toBe(
      f("static/chunks/root.js") + f("static/chunks/shared.js") + f("static/chunks/protected-layout.js") + f("static/chunks/loading.js") + f("static/chunks/dashboard.js"),
    );
    expect(sizes?.["/login"]).toBe(f("static/chunks/root.js") + f("static/chunks/login.js"));
  });

  it("reports the growth over a baseline and warns, without failing, above the budget", () => {
    const current = { "/a": 120_000, "/b": 100_500, "/new": 5_000 };
    const baseline = { "/a": 80_000, "/b": 100_000, "/gone": 1 };
    expect(initialJsGrowth(current, baseline)).toEqual([
      { route: "/a", growth: 40_000 },
      { route: "/b", growth: 500 },
    ]);
    const report = initialJsReport(current, baseline);
    expect(report.lines).toEqual([
      "Initial JS (gzip) of 3 pages: largest 120.0 kB (/a).",
      "Initial JS growth over the baseline: largest +40.0 kB (/a).",
    ]);
    expect(report.warnings).toEqual(["initial JS of /a grows 40.0 kB, above the 30.0 kB budget (D51)"]);
    expect(initialJsReport({ "/a": 80_000 + INITIAL_JS_BUDGET }, { "/a": 80_000 }).warnings).toEqual([]);
    expect(initialJsReport(null, null).lines).toEqual(["Initial JS: not measured (no build-manifest.json or app-build-manifest.json)."]);
  });

  it("parses the build directory and the --json and --baseline flags in any order", () => {
    expect(parseArgs([])).toEqual({ nextDir: "apps/web/.next", json: null, baseline: null });
    expect(parseArgs(["--baseline", "b.json", "x/.next", "--json", "j.json"])).toEqual({ nextDir: "x/.next", json: "j.json", baseline: "b.json" });
    expect(() => parseArgs(["--json"])).toThrow("--json needs a file");
    expect(() => parseArgs(["--baseline", "--json", "j.json"])).toThrow("--baseline needs a file");
    expect(() => parseArgs(["--basline", "b.json"])).toThrow("unknown option --basline");
  });

  it("prints the report, writes --json and still exits 0 above the budget", () => {
    const dir = build();
    const json = path.join(dir, "initial.json");
    const first = run(dir, "--json", json);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("Initial JS (gzip) of 2 pages");
    const baseline = path.join(dir, "baseline.json");
    writeFileSync(baseline, JSON.stringify({ "/(protected)/dashboard": 0, "/login": 0 }));
    // A tiny baseline makes no page grow 30 kB here; the warning path is covered above.
    const second = run(dir, "--baseline", baseline);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Initial JS growth over the baseline");
    expect(run(dir, "--baseline", path.join(dir, "missing.json")).stdout).toContain("not measured (no baseline");
    const broken = path.join(dir, "broken.json");
    writeFileSync(broken, "{ not json");
    const third = run(dir, "--baseline", broken);
    expect(third.status).toBe(0);
    expect(third.stdout).toContain(`not measured (the baseline at ${broken} is not JSON)`);
    for (const shape of ["null", "[1]", '{"/a":"x"}']) {
      writeFileSync(broken, shape);
      const result = run(dir, "--baseline", broken);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`not measured (the baseline at ${broken} is not a map of page sizes)`);
    }
    const typo = run(dir, "--basline", baseline);
    expect(typo.status).toBe(2);
    expect(typo.stderr).toContain("::error::unknown option --basline");
  });

  it("says the initial JS is not measured when the build has no manifests, and still passes", () => {
    const result = run(fakeBuild({ "/page": "/" }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Initial JS: not measured");
  });
});
