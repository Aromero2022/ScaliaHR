import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { exportTenant, TenantExportJob, type SqlRunner } from "../src/backup.js";

const tenantId = "a0000000-0000-0000-0000-000000000001";
const dir = mkdtempSync(path.join(tmpdir(), "export-unit-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Answers the three queries exportTenant makes, from fixed rows. */
function fakeDb(rows: Record<string, string[]>, failOn?: string): SqlRunner {
  return {
    async executeSql(text, values = []) {
      if (text.includes("tenant_backup_tables")) return { rows: Object.keys(rows).map((table_name) => ({ table_name })) };
      if (text.includes("backup_schema_version")) return { rows: [{ version: "20261104050000" }] };
      const table = text.includes("'tenants'") ? "tenants" : String(values[1]);
      if (table === failOn) throw new Error("connection lost");
      return { rows: (rows[table] ?? []).map((r) => ({ r })) };
    },
  };
}

describe("exportTenant (D23)", () => {
  it("writes manifest, rows exactly as printed by Postgres, and a trailer that checks them", async () => {
    const rows = {
      tenants: [`{"id": "${tenantId}", "name": "Acme"}`],
      users: ['{"id": "u1", "salary": 12345678901234567890.12}', '{"id": "u2"}'],
      audit_logs: [],
    };
    const result = await exportTenant(fakeDb(rows), tenantId, dir, new Date("2026-11-04T10:00:00Z"));
    expect(result.rows).toBe(3);
    expect(result.counts).toEqual({ tenants: 1, users: 2, audit_logs: 0 });
    expect(result.path).toBe(path.join(dir, "tenants", tenantId, "2026-11-04T10-00-00-000Z.export.gz"));

    const lines = gunzipSync(readFileSync(result.path)).toString("utf-8").trimEnd().split("\n");
    const manifest = JSON.parse(lines[0].split("\t")[1]);
    expect(manifest).toEqual({
      format: "scaliahr.tenant-export",
      version: 1,
      tenantId,
      schemaVersion: "20261104050000",
      createdAt: "2026-11-04T10:00:00.000Z",
      tables: ["tenants", "users", "audit_logs"],
    });
    const body = lines.slice(1, -1);
    expect(body).toEqual([`tenants\t${rows.tenants[0]}`, `users\t${rows.users[0]}`, `users\t${rows.users[1]}`]);
    const end = JSON.parse(lines.at(-1)!.split("\t")[1]);
    const sha = createHash("sha256").update(body.map((l) => `${l}\n`).join("")).digest("hex");
    expect(end).toEqual({ counts: result.counts, rows: 3, sha256: sha });
  });

  it("refuses a tenant that does not exist", async () => {
    await expect(exportTenant(fakeDb({ tenants: [] }), tenantId, dir)).rejects.toThrow(/does not exist/);
  });

  it("leaves no partial file behind when a query fails midway", async () => {
    const out = mkdtempSync(path.join(tmpdir(), "export-fail-"));
    try {
      const db = fakeDb({ tenants: ['{"id": "t"}'], users: ['{"id": "u"}'] }, "users");
      await expect(exportTenant(db, tenantId, out)).rejects.toThrow(/connection lost/);
      expect(readdirSync(path.join(out, "tenants", tenantId))).toEqual([]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("accepts only a tenant id as job data", () => {
    expect(TenantExportJob.safeParse({ tenantId }).success).toBe(true);
    expect(TenantExportJob.safeParse({ tenantId: "acme" }).success).toBe(false);
    expect(TenantExportJob.safeParse({ tenantId, path: "/etc" }).success).toBe(false);
  });
});
