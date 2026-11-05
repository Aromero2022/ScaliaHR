// D30 — a client component ("use client") must not import a module marked
// `import "server-only"`, directly or through other local modules. Next.js
// would fail the build anyway; this names the chain in the editor and in CI.
// "use server" files are not followed: a client only gets a reference to them.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const BLOCKED_PACKAGES = new Set(["server-only", "@prisma/client", "pg", "pg-boss"]);
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];
const MARKER = /^\s*import\s+["']server-only["'];?\s*$/m;
const USE_SERVER = /^\s*["']use server["'];?/;
// Local imports and re-exports, leaving out `import type` / `export type`.
const IMPORTS = /(?:^|[\s;])(?:import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolve(specifier, fromFile, srcDir) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(srcDir, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  for (const ext of EXTENSIONS) {
    const file = base + ext;
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

/** The chain of files from `file` to a server-only module, or null. */
function serverOnlyChain(file, srcDir, cache, visiting = new Set()) {
  if (cache.has(file)) return cache.get(file);
  if (visiting.has(file)) return null;
  visiting.add(file);
  const source = readFileSync(file, "utf-8");
  let chain = null;
  if (MARKER.test(source)) chain = [file];
  else if (!USE_SERVER.test(source)) {
    for (const match of source.matchAll(IMPORTS)) {
      const target = resolve(match[1] ?? match[2], file, srcDir);
      const rest = target && serverOnlyChain(target, srcDir, cache, visiting);
      if (rest) {
        chain = [file, ...rest];
        break;
      }
    }
  }
  cache.set(file, chain);
  return chain;
}

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow importing server-only modules from client components (D30)" },
    schema: [{ type: "object", properties: { srcDir: { type: "string" } }, required: ["srcDir"], additionalProperties: false }],
    messages: {
      package: "'{{name}}' is server-only and cannot be imported from a client component.",
      module: "'{{name}}' reaches a server-only module ({{chain}}) and cannot be imported from a client component.",
    },
  },
  create(context) {
    const { srcDir } = context.options[0];
    const sourceCode = context.sourceCode;
    const first = sourceCode.ast.body[0];
    const isClient = first?.type === "ExpressionStatement" && first.directive === "use client";
    if (!isClient) return {};
    const cache = new Map();

    function check(node, name) {
      if (typeof name !== "string") return;
      if (BLOCKED_PACKAGES.has(name)) {
        context.report({ node, messageId: "package", data: { name } });
        return;
      }
      const target = resolve(name, context.filename, srcDir);
      const chain = target && serverOnlyChain(target, srcDir, cache);
      if (chain) {
        const shown = chain.map((file) => path.relative(srcDir, file)).join(" → ");
        context.report({ node, messageId: "module", data: { name, chain: shown } });
      }
    }

    return {
      ImportDeclaration(node) {
        if (node.importKind !== "type") check(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source && node.exportKind !== "type") check(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        if (node.exportKind !== "type") check(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") check(node, node.source.value);
      },
    };
  },
};

export default rule;
