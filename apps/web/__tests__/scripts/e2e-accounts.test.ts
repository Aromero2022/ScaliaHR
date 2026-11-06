import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { privateDir, runSecrets, scanArtifacts, unzipEntries } from "../../../../scripts/e2e-accounts.mjs";

/**
 * D44: the e2e accounts script. Its database work runs against Supabase local
 * in the Docker job (npm run e2e); here, what needs no database: the guards,
 * the private folder and the artifact scan.
 */

const REPO = path.resolve(__dirname, "../../../..");
const SCRIPT = path.join(REPO, "scripts/e2e-accounts.mjs");
const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const temp = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const PASSWORD = "k3Jd8_aQ-zP1vX9mT0bL5yC2nR7wE4sF";
const TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/** A zip as Playwright embeds it in its HTML report (one deflated entry, one stored). */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  Object.entries(files).forEach(([name, text], i) => {
    const raw = Buffer.from(text);
    const method = i === 0 ? 8 : 0;
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  });
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

function htmlReport(files: Record<string, string>) {
  return `<html><script>window.playwrightReportBase64 = "data:application/zip;base64,${zip(files).toString("base64")}";</script></html>`;
}

function artifacts(files: Record<string, string>) {
  const dir = temp("d44-artifacts-");
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

describe("e2e-accounts (D44)", () => {
  it("refuses a non-local Supabase or database before touching anything", () => {
    const env = { ...process.env, E2E_PRIVATE_DIR: temp("d44-private-") };
    const remote = spawnSync("node", [SCRIPT, "setup", "postgresql://postgres:x@127.0.0.1:54322/postgres", "https://abc.supabase.co", "k", "k"], { encoding: "utf-8", env });
    expect(remote.status).toBe(1);
    expect(remote.stderr).toContain("refusing to seed a non-local Supabase");
    const db = spawnSync("node", [SCRIPT, "setup", "postgresql://postgres:x@db.example.com:5432/postgres", "http://127.0.0.1:54321", "k", "k"], { encoding: "utf-8", env });
    expect(db.status).toBe(1);
    expect(db.stderr).toContain("non-local database");
    const cleanup = spawnSync("node", [SCRIPT, "cleanup", "postgresql://postgres:x@127.0.0.1:54322/postgres?host=db.example.com"], { encoding: "utf-8", env });
    expect(cleanup.status).toBe(1);
    expect(cleanup.stderr).toContain("query parameters");
  });

  it("keeps the secrets in a private folder outside the repository", () => {
    expect(() => privateDir({})).toThrow("E2E_PRIVATE_DIR is not set");
    expect(() => privateDir({ E2E_PRIVATE_DIR: path.join(REPO, "apps/web/e2e-artifacts/private") })).toThrow("outside the repository");
    const dir = privateDir({ E2E_PRIVATE_DIR: temp("d44-private-") });
    expect(spawnSync("stat", ["-c", "%a", dir], { encoding: "utf-8" }).stdout.trim()).toBe("700");
  });

  it("collects the run's secrets, the ones the tests registered included", () => {
    const dir = temp("d44-private-");
    expect(() => runSecrets(dir)).toThrow("the scan needs the secrets of this run");
    writeFileSync(path.join(dir, "accounts.json"), JSON.stringify({ password: PASSWORD, accounts: { admin: { totp: { secret: TOTP } }, empleada: {} } }));
    writeFileSync(path.join(dir, "runtime-secrets.txt"), "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U\n\n");
    expect(runSecrets(dir)).toEqual([PASSWORD, TOTP, "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U"]);
    writeFileSync(path.join(dir, "accounts.json"), JSON.stringify({ password: "short", accounts: {} }));
    expect(() => runSecrets(dir)).toThrow("too short");
  });

  it("reads the stored and deflated entries of a zip", () => {
    const entries = unzipEntries(zip({ "a.md": "uno", "data/b.json": "dos" }));
    expect(entries.map((e: { name: string; data: Buffer }) => [e.name, e.data.toString()])).toEqual([
      ["a.md", "uno"],
      ["data/b.json", "dos"],
    ]);
  });

  it("finds a secret in a file, URL-encoded, and inside the HTML report's embedded zip", () => {
    const dir = artifacts({
      "results/x/error-context.md": `- textbox "Contraseña": ${PASSWORD}`,
      "axe/axe-report.json": JSON.stringify({ url: `/x?s=${encodeURIComponent("clave con espacios/&más")}` }),
      "report/index.html": htmlReport({ "report.json": `{"title":"Fill \\"${PASSWORD}\\""}`, "data/ok.md": "nada" }),
      "captures/login-360-claro.png": "\u0089PNG sin texto",
    });
    const extract = temp("d44-extract-");
    const { files, hits } = scanArtifacts(dir, extract, [PASSWORD, TOTP, "clave con espacios/&más"]);
    expect(hits.sort()).toEqual(["axe/axe-report.json", "report/index.html (embedded) report.json", "results/x/error-context.md"]);
    expect(files).toBe(6);
    // The embedded files stay on disk for gitleaks.
    expect(readFileSync(path.join(extract, "report/index.html.zip-0/report.json"), "utf-8")).toContain("Fill");
  });

  it("passes artifacts that carry no secret", () => {
    const dir = artifacts({
      "report/index.html": htmlReport({ "report.json": '{"title":"Evaluate"}' }),
      "axe/axe-summary.md": "Ninguna.",
    });
    expect(scanArtifacts(dir, temp("d44-extract-"), [PASSWORD, TOTP]).hits).toEqual([]);
  });
});
