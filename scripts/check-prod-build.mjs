// The production build of apps/web must ship no debug or test route, no
// browser source maps (D29, D32), no demo credentials in what the browser
// downloads (D41) and no e2e tooling (D44). Run by CI right after `next build`:
//   node scripts/check-prod-build.mjs [apps/web/.next]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// A route is refused when any segment, split on - _ . and case-insensitive,
// is one of these words, or when a segment starts with "__".
export const FORBIDDEN_WORDS = new Set([
  "debug", "test", "tests", "testing", "dev", "devtools", "playground", "sandbox",
  "mock", "mocks", "fixture", "fixtures", "e2e", "seed", "seeds", "phpinfo",
]);
// Next.js internals of the pages router that every build carries.
const NEXT_INTERNALS = new Set(["/_app", "/_document", "/_error", "/404", "/500", "/_not-found"]);

export function isForbiddenRoute(route) {
  return route
    .split("/")
    .filter(Boolean)
    .some((segment) => segment.startsWith("__") || segment.toLowerCase().split(/[-_.]/).some((word) => FORBIDDEN_WORDS.has(word)));
}

/** Every route of the build: app router pages and handlers, and pages router pages. */
export function buildRoutes(nextDir) {
  const read = (file) => JSON.parse(readFileSync(path.join(nextDir, file), "utf-8"));
  const app = Object.values(read("app-path-routes-manifest.json"));
  const pagesFile = path.join(nextDir, "server/pages-manifest.json");
  const pages = existsSync(pagesFile) ? Object.keys(read("server/pages-manifest.json")) : [];
  return [...new Set([...app, ...pages])].filter((route) => !NEXT_INTERNALS.has(route)).sort();
}

export function browserSourceMaps(nextDir) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".map")) found.push(path.relative(nextDir, full));
    }
  };
  const staticDir = path.join(nextDir, "static");
  if (existsSync(staticDir)) walk(staticDir);
  return found;
}

// D41: the demo login of supabase/seed.sql. The hint now comes from a server
// variable; if either string reaches the client bundle, something hard-coded it.
export const DEMO_CREDENTIALS = ["Demo1234", "elena.martinez@acme.dev"];

function walkFiles(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, visit);
    else visit(full);
  }
}

/** Files under .next/static (the client bundle) that contain a demo credential. */
export function demoCredentialsInClientBundle(nextDir) {
  const found = [];
  const staticDir = path.join(nextDir, "static");
  if (!existsSync(staticDir)) return found;
  walkFiles(staticDir, (file) => {
    const text = readFileSync(file, "latin1");
    for (const secret of DEMO_CREDENTIALS) if (text.includes(secret)) found.push(`${path.relative(nextDir, file)}: ${secret}`);
  });
  return found;
}

// D44: axe (MPL-2.0) and Playwright are dev dependencies for the e2e only.
// Neither may reach the browser bundle (.next/static) nor the standalone server
// (.next/standalone), which are the two things the production image copies.
export const TEST_PACKAGES = new Set(["axe-core", "@axe-core", "playwright", "playwright-core", "@playwright"]);
export const TEST_TOOL_MARKERS = ["Deque Systems", "axe-core", "playwright-core"];

/** Test packages in the standalone server's node_modules, and their marks in the client bundle. */
export function testToolsInBuild(nextDir) {
  const found = [];
  const findPackages = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === "node_modules") {
        for (const pkg of readdirSync(full)) if (TEST_PACKAGES.has(pkg)) found.push(path.relative(nextDir, path.join(full, pkg)));
      }
      findPackages(full);
    }
  };
  const standalone = path.join(nextDir, "standalone");
  if (existsSync(standalone)) findPackages(standalone);
  const staticDir = path.join(nextDir, "static");
  if (existsSync(staticDir)) {
    walkFiles(staticDir, (file) => {
      const text = readFileSync(file, "latin1");
      for (const marker of TEST_TOOL_MARKERS) if (text.includes(marker)) found.push(`${path.relative(nextDir, file)}: ${marker}`);
    });
  }
  return found;
}

function main() {
  const nextDir = path.resolve(process.argv[2] ?? "apps/web/.next");
  if (!existsSync(path.join(nextDir, "app-path-routes-manifest.json"))) {
    console.error(`::error::no production build in ${nextDir}; run next build first`);
    process.exit(1);
  }
  const routes = buildRoutes(nextDir);
  const forbidden = routes.filter(isForbiddenRoute);
  const maps = browserSourceMaps(nextDir);
  const demo = demoCredentialsInClientBundle(nextDir);
  const tools = testToolsInBuild(nextDir);
  for (const route of forbidden) console.error(`::error::debug or test route in the production build: ${route}`);
  for (const map of maps) console.error(`::error::browser source map in the production build: ${map}`);
  for (const hit of demo) console.error(`::error::demo credential in the client bundle: ${hit}`);
  for (const hit of tools) console.error(`::error::e2e tooling in the production build: ${hit}`);
  if (forbidden.length > 0 || maps.length > 0 || demo.length > 0 || tools.length > 0) process.exit(1);
  console.log(
    `Production build: ${routes.length} routes, none for debug or tests; no browser source maps; no demo credentials in the client bundle; no axe or Playwright in the bundle or the standalone server.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
