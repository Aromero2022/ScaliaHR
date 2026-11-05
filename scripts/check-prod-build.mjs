// The production build of apps/web must ship no debug or test route and no
// browser source maps (D29, D32). Run by CI right after `next build`:
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

function main() {
  const nextDir = path.resolve(process.argv[2] ?? "apps/web/.next");
  if (!existsSync(path.join(nextDir, "app-path-routes-manifest.json"))) {
    console.error(`::error::no production build in ${nextDir}; run next build first`);
    process.exit(1);
  }
  const routes = buildRoutes(nextDir);
  const forbidden = routes.filter(isForbiddenRoute);
  const maps = browserSourceMaps(nextDir);
  for (const route of forbidden) console.error(`::error::debug or test route in the production build: ${route}`);
  for (const map of maps) console.error(`::error::browser source map in the production build: ${map}`);
  if (forbidden.length > 0 || maps.length > 0) process.exit(1);
  console.log(`Production build: ${routes.length} routes, none for debug or tests; no browser source maps.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
