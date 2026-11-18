// The Dockerfiles (D17) prune with `npx turbo@${TURBO_VERSION}`: the turbo that
// runs is the ARG's, whatever version package-lock.json locks. Dependabot's npm
// updates bump turbo only in the lockfile (D33), so CI fails when a
// Dockerfile's ARG TURBO_VERSION is not the lockfile's turbo.
//   node scripts/check-turbo-version.mjs [repo root]
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DOCKERFILES = ["apps/web/Dockerfile", "apps/worker/Dockerfile"];
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** turbo's version in package-lock.json: the root `node_modules/turbo` entry, never a nested copy. */
export function lockedTurboVersion(lockText) {
  const version = JSON.parse(lockText)?.packages?.["node_modules/turbo"]?.version;
  if (typeof version !== "string") throw new Error('package-lock.json has no "node_modules/turbo" entry');
  if (!EXACT_VERSION.test(version)) throw new Error(`package-lock.json locks turbo "${version}", not an exact version`);
  return version;
}

/**
 * The value of `ARG TURBO_VERSION=<version>` in a Dockerfile. A bare
 * `ARG TURBO_VERSION` (the stage's redeclaration) carries none and is skipped.
 */
export function dockerfileTurboVersion(text) {
  const values = [...text.matchAll(/^[ \t]*ARG[ \t]+TURBO_VERSION[ \t]*=(\S*)[ \t]*$/gim)].map((match) =>
    match[1].replace(/^(["'])(.*)\1$/, "$2"),
  );
  if (values.length === 0) throw new Error('no "ARG TURBO_VERSION=<version>"');
  const distinct = [...new Set(values)];
  if (distinct.length > 1) throw new Error(`ARG TURBO_VERSION has more than one value: ${distinct.join(", ")}`);
  if (!EXACT_VERSION.test(distinct[0])) throw new Error(`ARG TURBO_VERSION is "${distinct[0]}", not an exact version`);
  return distinct[0];
}

const reason = (error) => (error.code === "ENOENT" ? "file not found" : error.message);

/**
 * The lockfile's turbo and one problem per file that is missing or unreadable,
 * has no single exact ARG TURBO_VERSION, or pins another turbo.
 */
export function turboVersionProblems(root) {
  let locked;
  try {
    locked = lockedTurboVersion(readFileSync(path.join(root, "package-lock.json"), "utf-8"));
  } catch (error) {
    return { locked: null, problems: [{ file: "package-lock.json", message: `${reason(error)}; cannot check ARG TURBO_VERSION` }] };
  }
  const problems = [];
  for (const file of DOCKERFILES) {
    let pinned;
    try {
      pinned = dockerfileTurboVersion(readFileSync(path.join(root, file), "utf-8"));
    } catch (error) {
      problems.push({ file, message: reason(error) });
      continue;
    }
    if (pinned !== locked) {
      problems.push({ file, message: `ARG TURBO_VERSION is ${pinned} but package-lock.json locks turbo ${locked}; set ARG TURBO_VERSION=${locked}` });
    }
  }
  return { locked, problems };
}

// Workflow command data: % and line breaks are escaped, so a message stays one annotation.
const escapeData = (text) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

function main() {
  const { locked, problems } = turboVersionProblems(path.resolve(process.argv[2] ?? "."));
  for (const { file, message } of problems) console.error(`::error file=${file}::${escapeData(message)}`);
  if (problems.length > 0) process.exit(1);
  console.log(`ARG TURBO_VERSION is ${locked} in ${DOCKERFILES.join(" and ")}, the turbo locked in package-lock.json.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
