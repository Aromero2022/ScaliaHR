// The production build of apps/web must ship no debug or test route, no
// browser source maps (D29, D32), no demo credentials in what the browser
// downloads (D41) and no e2e tooling (D44). Run by CI right after `next build`:
//   node scripts/check-prod-build.mjs [apps/web/.next]
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

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

// D51: the JS a page needs before it is interactive. For every app router page:
// build-manifest's rootMainFiles plus app-build-manifest's chunks of the page and
// of each segment above it (layout, template, loading, error, not-found). Only
// .js files, each counted once, gzip level 9, in bytes (kB = 1000). Chunks loaded
// later with import() are not in these manifests, so they are not counted.
export const SEGMENT_FILES = ["layout", "template", "loading", "error", "not-found"];
// D51: growth of a page's initial JS over main's build above which the loop stops
// and proposes another option. Reported as a warning, never a failure.
export const INITIAL_JS_BUDGET = 30_000;

/**
 * Initial JS per page route in gzip bytes, or null when the build has no manifests.
 * @param {string} nextDir
 * @returns {Record<string, number> | null}
 */
export function initialJs(nextDir) {
  const buildFile = path.join(nextDir, "build-manifest.json");
  const appFile = path.join(nextDir, "app-build-manifest.json");
  if (!existsSync(buildFile) || !existsSync(appFile)) return null;
  const root = JSON.parse(readFileSync(buildFile, "utf-8")).rootMainFiles ?? [];
  const entries = JSON.parse(readFileSync(appFile, "utf-8")).pages ?? {};
  const isJs = (file) => file.endsWith(".js");
  const gzipped = new Map();
  const size = (file) => {
    if (!gzipped.has(file)) gzipped.set(file, gzipSync(readFileSync(path.join(nextDir, file)), { level: 9 }).length);
    return gzipped.get(file);
  };
  const routes = {};
  for (const entry of Object.keys(entries).sort()) {
    if (!entry.endsWith("/page")) continue;
    const segments = entry.split("/").slice(1, -1);
    const files = new Set(root.filter(isJs));
    const add = (key) => (entries[key] ?? []).filter(isJs).forEach((file) => files.add(file));
    for (let depth = 0; depth <= segments.length; depth++) {
      const prefix = `/${segments.slice(0, depth).join("/")}`;
      for (const name of SEGMENT_FILES) add(path.posix.join(prefix, name));
    }
    add(entry);
    routes[entry.slice(0, -"/page".length) || "/"] = [...files].reduce((sum, file) => sum + size(file), 0);
  }
  return routes;
}

/**
 * Growth of each route present in both measurements, largest first.
 * @param {Record<string, number>} current
 * @param {Record<string, number>} baseline
 * @returns {{ route: string, growth: number }[]}
 */
export function initialJsGrowth(current, baseline) {
  return Object.keys(current)
    .filter((route) => route in baseline)
    .map((route) => ({ route, growth: current[route] - baseline[route] }))
    .sort((a, b) => b.growth - a.growth || a.route.localeCompare(b.route));
}

const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

/**
 * The report lines of the initial JS, and the warnings of a growth above the budget.
 * @param {Record<string, number> | null} current
 * @param {Record<string, number> | null} baseline
 * @returns {{ lines: string[], warnings: string[] }}
 */
export function initialJsReport(current, baseline) {
  if (!current) return { lines: ["Initial JS: not measured (no build-manifest.json or app-build-manifest.json)."], warnings: [] };
  const routes = Object.entries(current).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const lines = [`Initial JS (gzip) of ${routes.length} pages: largest ${kB(routes[0]?.[1] ?? 0)} (${routes[0]?.[0] ?? "none"}).`];
  const warnings = [];
  if (baseline) {
    const growth = initialJsGrowth(current, baseline);
    const top = growth[0];
    lines.push(top ? `Initial JS growth over the baseline: largest ${top.growth >= 0 ? "+" : ""}${kB(top.growth)} (${top.route}).` : "Initial JS growth: no page in common with the baseline.");
    for (const { route, growth: bytes } of growth) {
      if (bytes > INITIAL_JS_BUDGET) warnings.push(`initial JS of ${route} grows ${kB(bytes)}, above the ${kB(INITIAL_JS_BUDGET)} budget (D51)`);
    }
  }
  return { lines, warnings };
}

/**
 * `[nextDir] [--json <file>] [--baseline <file>]`. Throws on a flag without its
 * file or an unknown flag, so a typo is not read as the build directory.
 * @param {string[]} argv
 * @returns {{ nextDir: string, json: string | null, baseline: string | null }}
 */
export function parseArgs(argv) {
  const args = { nextDir: "apps/web/.next", json: null, baseline: null };
  const file = (flag, value) => {
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a file`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") args.json = file("--json", argv[++i]);
    else if (argv[i] === "--baseline") args.baseline = file("--baseline", argv[++i]);
    else if (argv[i].startsWith("--")) throw new Error(`unknown option ${argv[i]}`);
    else args.nextDir = argv[i];
  }
  return args;
}

/**
 * The baseline's sizes, or null with the reason it is not used.
 * @param {string | null} file
 * @returns {{ sizes: Record<string, number> | null, reason: string | null }}
 */
function readBaseline(file) {
  if (!file) return { sizes: null, reason: null };
  if (!existsSync(file)) return { sizes: null, reason: `no baseline at ${file}` };
  let sizes;
  try {
    sizes = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return { sizes: null, reason: `the baseline at ${file} is not JSON` };
  }
  const valid = sizes !== null && typeof sizes === "object" && !Array.isArray(sizes) && Object.values(sizes).every((v) => typeof v === "number");
  return valid ? { sizes, reason: null } : { sizes: null, reason: `the baseline at ${file} is not a map of page sizes` };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(2);
  }
  const nextDir = path.resolve(args.nextDir);
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
  // D51: the initial JS is reported, never failing.
  const current = initialJs(nextDir);
  const { sizes: baseline, reason } = readBaseline(args.baseline);
  if (reason) console.log(`Initial JS growth: not measured (${reason}).`);
  const report = initialJsReport(current, baseline);
  for (const line of report.lines) console.log(line);
  for (const warning of report.warnings) console.log(`::warning::${warning}`);
  if (args.json && current) writeFileSync(args.json, `${JSON.stringify(current, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
