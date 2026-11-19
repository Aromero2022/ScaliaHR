// D36 diagnostics (D54): one line per file of the web image's .next/standalone,
// "<sha256>  <path>", with the build's BUILD_ID replaced by <BUILD_ID> in every
// path and every file's bytes, so two builds can be compared by content.
// It runs inside the image (node, no dependencies, read-only mount). CI runs it
// in the image of the measured container (.github/workflows/ci.yml):
//   docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
//     --entrypoint node -v "$PWD/scripts/d36-standalone-files.mjs:/d36/standalone-files.mjs:ro" \
//     "$image" /d36/standalone-files.mjs /app
// In the image, /app is .next/standalone plus .next/static copied into
// apps/web/.next/static (apps/web/Dockerfile); static is left out.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MARKER = "<BUILD_ID>";
export const BUILD_ID_FILE = "apps/web/.next/BUILD_ID";
export const STATIC_DIR = "apps/web/.next/static";
/** Next.js writes a random id of 21 URL-safe characters; a short one would be replaced all over. */
const BUILD_ID = /^[A-Za-z0-9_-]{8,}$/;

/** Every occurrence of `needle` (not empty) in `bytes` replaced by `replacement`. */
export function replaceBytes(bytes, needle, replacement) {
  if (needle.length === 0) throw new Error("an empty needle");
  const parts = [];
  let from = 0;
  for (let at = bytes.indexOf(needle, from); at !== -1; at = bytes.indexOf(needle, from)) {
    parts.push(bytes.subarray(from, at), replacement);
    from = at + needle.length;
  }
  if (parts.length === 0) return bytes;
  parts.push(bytes.subarray(from));
  return Buffer.concat(parts);
}

/** Byte order of two strings' UTF-8 bytes. */
export const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** Relative paths of the files under `root`, "/"-joined, without `skip`. Unsorted. */
export function listFiles(root, skip = STATIC_DIR) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(path.join(root, dir))) {
      const rel = dir === "" ? name : `${dir}/${name}`;
      if (rel === skip) continue;
      if (lstatSync(path.join(root, rel)).isDirectory()) walk(rel);
      else out.push(rel);
    }
  };
  walk("");
  return out;
}

/**
 * The manifest lines of `root`, sorted by the path after BUILD_ID is replaced,
 * so the order does not depend on the build's id. A symlink is hashed by its
 * target, not followed. Throws when BUILD_ID is missing or not an id: then
 * nothing would be replaced.
 */
export function standaloneFiles(root) {
  let buildId;
  try {
    buildId = readFileSync(path.join(root, BUILD_ID_FILE), "utf-8").trim();
  } catch (error) {
    throw new Error(`cannot read ${BUILD_ID_FILE}: ${error.code ?? error.message}`);
  }
  if (!BUILD_ID.test(buildId)) throw new Error(`${BUILD_ID_FILE} does not hold a build id: ${JSON.stringify(buildId)}`);
  const needle = Buffer.from(buildId);
  const marker = Buffer.from(MARKER);
  return listFiles(root)
    .map((rel) => {
      if (/[\n\r]/.test(rel) || /^\s/.test(rel)) throw new Error(`a file name a manifest line cannot hold: ${JSON.stringify(rel)}`);
      const full = path.join(root, rel);
      const bytes = lstatSync(full).isSymbolicLink() ? Buffer.from(`symlink:${readlinkSync(full)}`) : readFileSync(full);
      return { rel: rel.split(buildId).join(MARKER), hash: createHash("sha256").update(replaceBytes(bytes, needle, marker)).digest("hex") };
    })
    .sort((a, b) => byBytes(a.rel, b.rel))
    .map(({ rel, hash }) => `${hash}  ${rel}`);
}

function main() {
  const root = process.argv[2] ?? "/app";
  try {
    process.stdout.write(`${standaloneFiles(root).join("\n")}\n`);
  } catch (error) {
    console.error(`d36-standalone-files: ${error.message}`);
    process.exit(1);
  }
}

/** True when this file is the script node was asked to run, through a symlink too. */
const isMain = () => {
  if (!process.argv[1]) return false;
  let given = process.argv[1];
  try {
    given = realpathSync(given);
  } catch {
    // Compare the path as given: a path node ran cannot fail to resolve, but never skip main() silently over it.
  }
  return pathToFileURL(given).href === import.meta.url || given === fileURLToPath(import.meta.url);
};

if (isMain()) main();
