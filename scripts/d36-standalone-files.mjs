// D36 diagnostics (D54): one line per file of the web image's .next/standalone,
// "<sha256>  <path>", with the build's BUILD_ID replaced by <BUILD_ID> in every
// path and every file's bytes, so two builds can be compared by content.
// It runs inside the image (node, no dependencies, read-only mount):
//   docker run --rm --network none --entrypoint node \
//     -v "$PWD/scripts/d36-standalone-files.mjs:/d36/standalone-files.mjs:ro" \
//     scaliahr-web:local /d36/standalone-files.mjs /app
// In the image, /app is .next/standalone plus .next/static copied into
// apps/web/.next/static (apps/web/Dockerfile); static is left out.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MARKER = "<BUILD_ID>";
export const BUILD_ID_FILE = "apps/web/.next/BUILD_ID";
export const STATIC_DIR = "apps/web/.next/static";

/** Every occurrence of `needle` in `bytes` replaced by `replacement`. */
export function replaceBytes(bytes, needle, replacement) {
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

/** Relative paths of the files under `root`, in byte order of their "/"-joined path, without `skip`. */
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
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The manifest lines of `root`. A symlink is hashed by its target, not followed.
 * Throws when BUILD_ID is missing or empty: without it nothing would be replaced.
 */
export function standaloneFiles(root) {
  let buildId;
  try {
    buildId = readFileSync(path.join(root, BUILD_ID_FILE), "utf-8").trim();
  } catch (error) {
    throw new Error(`cannot read ${BUILD_ID_FILE}: ${error.code ?? error.message}`);
  }
  if (buildId === "") throw new Error(`${BUILD_ID_FILE} is empty`);
  const needle = Buffer.from(buildId);
  const marker = Buffer.from(MARKER);
  return listFiles(root).map((rel) => {
    if (rel.includes("\n")) throw new Error(`a file name holds a line break: ${JSON.stringify(rel)}`);
    const full = path.join(root, rel);
    const bytes = lstatSync(full).isSymbolicLink() ? Buffer.from(`symlink:${readlinkSync(full)}`) : readFileSync(full);
    const hash = createHash("sha256").update(replaceBytes(bytes, needle, marker)).digest("hex");
    return `${hash}  ${rel.split(buildId).join(MARKER)}`;
  });
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
