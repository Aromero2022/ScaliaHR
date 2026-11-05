// The running web image must answer pages with a nonce-based CSP and put that
// nonce on every script it renders (D29). Run by CI after `npm run local:up`:
//   node scripts/check-csp.mjs http://localhost:3000/login
import { pathToFileURL } from "node:url";

/** What is wrong with a page's CSP header and scripts; empty when all is well. */
export function cspProblems(csp, html) {
  if (!csp) return ["no Content-Security-Policy header"];
  const problems = [];
  const script = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src ")) ?? "";
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(script)?.[1];
  if (!nonce) problems.push("script-src has no nonce");
  if (!script.includes("'strict-dynamic'")) problems.push("script-src lacks 'strict-dynamic'");
  for (const keyword of ["'unsafe-inline'", "'unsafe-eval'"]) {
    if (script.includes(keyword)) problems.push(`script-src allows ${keyword}`);
  }
  const tags = html.match(/<script\b[^>]*>/gi) ?? [];
  if (tags.length === 0) problems.push("the page has no scripts to check");
  for (const tag of tags) {
    if (!nonce || !tag.includes(`nonce="${nonce}"`)) problems.push(`script without the response nonce: ${tag.slice(0, 80)}`);
  }
  return problems;
}

async function main() {
  const url = process.argv[2];
  if (!url) throw new Error("usage: check-csp.mjs <url>");
  const response = await fetch(url, { redirect: "manual" });
  const html = await response.text();
  const problems = cspProblems(response.headers.get("content-security-policy"), html);
  if (response.status !== 200) problems.unshift(`${url} answered ${response.status}`);
  for (const problem of problems) console.error(`::error::${problem}`);
  if (problems.length > 0) process.exit(1);
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  console.log(`${url}: nonce-based CSP, ${scripts} scripts all carry the response nonce.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
