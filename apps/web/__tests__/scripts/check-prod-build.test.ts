import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildRoutes, isForbiddenRoute } from "../../../../scripts/check-prod-build.mjs";

/**
 * D32: CI runs scripts/check-prod-build.mjs on the production build; it fails
 * on any debug or test route and on browser source maps (D29).
 */

const REPO = path.resolve(__dirname, "../../../..");
const SCRIPT = path.join(REPO, "scripts/check-prod-build.mjs");
const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function fakeBuild(appRoutes: Record<string, string>, pages: Record<string, string> = {}, files: string[] = []) {
  const dir = mkdtempSync(path.join(tmpdir(), "d32-next-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "server"), { recursive: true });
  writeFileSync(path.join(dir, "app-path-routes-manifest.json"), JSON.stringify(appRoutes));
  writeFileSync(path.join(dir, "server/pages-manifest.json"), JSON.stringify({ "/_app": "pages/_app.js", ...pages }));
  for (const file of files) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), "");
  }
  return dir;
}

const run = (dir: string) => spawnSync("node", [SCRIPT, dir], { encoding: "utf-8" });

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

  it("fails when there is no build", () => {
    expect(run(path.join(tmpdir(), "no-such-next-dir")).status).toBe(1);
  });
});
