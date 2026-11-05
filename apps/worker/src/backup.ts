import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { z } from "zod";

// D23 — per-tenant logical export. One gzip file per run:
//   #manifest\t{format, version, tenantId, schemaVersion, createdAt, tables}
//   <table>\t<row as JSON, exactly as Postgres printed it>
//   #end\t{counts, rows, sha256 of every row line}
// scripts/restore-tenant.mjs reads it back.

export const EXPORT_FORMAT = "scaliahr.tenant-export";
export const EXPORT_VERSION = 1;

export const TenantExportJob = z.object({ tenantId: z.guid() }).strict();

export interface SqlRunner {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface TenantExport {
  path: string;
  rows: number;
  counts: Record<string, number>;
}

export async function exportTenant(
  db: SqlRunner,
  tenantId: string,
  backupDir: string,
  now: Date = new Date(),
): Promise<TenantExport> {
  const { rows: tableRows } = await db.executeSql("SELECT table_name FROM public.tenant_backup_tables()");
  const tables = (tableRows as { table_name: string }[]).map((r) => r.table_name);
  const { rows: versionRows } = await db.executeSql("SELECT public.backup_schema_version() AS version");
  const schemaVersion = (versionRows[0] as { version: string }).version;

  const tenant = await db.executeSql("SELECT r FROM public.tenant_export_rows($1, 'tenants') AS r", [tenantId]);
  if (tenant.rows.length !== 1) throw new Error(`tenant ${tenantId} does not exist`);

  const dir = path.join(backupDir, "tenants", tenantId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${now.toISOString().replace(/[:.]/g, "-")}.export.gz`);
  const partial = `${file}.partial`;

  const counts: Record<string, number> = {};
  const hash = createHash("sha256");
  let total = 0;

  async function* lines(): AsyncGenerator<string> {
    const manifest = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      tenantId,
      schemaVersion,
      createdAt: now.toISOString(),
      tables,
    };
    yield `#manifest\t${JSON.stringify(manifest)}\n`;
    for (const table of tables) {
      const { rows } = await db.executeSql("SELECT r FROM public.tenant_export_rows($1, $2) AS r", [tenantId, table]);
      counts[table] = rows.length;
      for (const row of rows as { r: string }[]) {
        const line = `${table}\t${row.r}\n`;
        hash.update(line);
        total += 1;
        yield line;
      }
    }
    yield `#end\t${JSON.stringify({ counts, rows: total, sha256: hash.digest("hex") })}\n`;
  }

  try {
    await pipeline(Readable.from(lines()), createGzip(), createWriteStream(partial, { mode: 0o600 }));
    await rename(partial, file);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  return { path: file, rows: total, counts };
}
