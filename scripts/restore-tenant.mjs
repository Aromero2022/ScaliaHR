// Restores one tenant from a per-tenant export (D23) without touching any other
// tenant. LOCAL database only until Phase 23:
//   node scripts/restore-tenant.mjs --tenant <uuid> --file <export.gz> [--db-url <url>]
//
// In one transaction: replaces every row of the tenant in the tables the export
// covers with the exported ones, keeps the audit entries written after the
// export whose user still exists, and refuses to commit if any foreign key is
// left dangling or a count does not match. Audit entries that cannot be kept
// go to a report file next to the export, so nothing disappears silently.
import { createHash } from "node:crypto";
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createGunzip } from "node:zlib";
import pg from "pg";
import { assertLocalDbUrl } from "./set-local-role-passwords.mjs";

export const EXPORT_FORMAT = "scaliahr.tenant-export";
export const EXPORT_VERSION = 1;
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 500;

/** Reads and checks an export: format, integrity hash and per-table counts. */
export async function readExport(file) {
  const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  const hash = createHash("sha256");
  const rows = new Map();
  let manifest = null;
  let end = null;
  for await (const line of lines) {
    const tab = line.indexOf("\t");
    if (tab < 0) throw new Error("malformed export: a line has no tab");
    const head = line.slice(0, tab);
    const body = line.slice(tab + 1);
    if (end) throw new Error("malformed export: content after the end line");
    if (head === "#manifest") {
      if (manifest) throw new Error("malformed export: two manifests");
      manifest = JSON.parse(body);
      if (manifest.format !== EXPORT_FORMAT || manifest.version !== EXPORT_VERSION) {
        throw new Error(`not a ${EXPORT_FORMAT} v${EXPORT_VERSION} file`);
      }
      for (const table of manifest.tables) rows.set(table, []);
    } else if (head === "#end") {
      end = JSON.parse(body);
    } else {
      if (!manifest) throw new Error("malformed export: rows before the manifest");
      if (!rows.has(head)) throw new Error(`malformed export: table ${head} is not in the manifest`);
      hash.update(`${line}\n`);
      rows.get(head).push(body);
    }
  }
  if (!manifest || !end) throw new Error("incomplete export: manifest or end line missing");
  if (hash.digest("hex") !== end.sha256) throw new Error("export is corrupted: SHA-256 does not match");
  let total = 0;
  for (const [table, list] of rows) {
    if (list.length !== end.counts[table]) throw new Error(`export is corrupted: count mismatch in ${table}`);
    total += list.length;
  }
  if (total !== end.rows) throw new Error("export is corrupted: total row count does not match");
  return { manifest, rows };
}

async function foreignKeyOrphans(client) {
  const { rows: fks } = await client.query(`
    SELECT c.conname, c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent,
           array(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n, i)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.i) AS cols,
           array(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n, i)
                 JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.i) AS refs
    FROM pg_constraint c
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`);
  const broken = [];
  for (const fk of fks) {
    const q = (name) => client.escapeIdentifier(name);
    const notNull = fk.cols.map((c) => `c.${q(c)} IS NOT NULL`).join(" AND ");
    const match = fk.cols.map((c, i) => `p.${q(fk.refs[i])} = c.${q(c)}`).join(" AND ");
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM ${fk.child} c WHERE ${notNull}
         AND NOT EXISTS (SELECT 1 FROM ${fk.parent} p WHERE ${match})`,
    );
    if (rows[0].n > 0) broken.push(`${fk.conname} (${rows[0].n} rows)`);
  }
  return broken;
}

/** Replaces the tenant's rows with the export's. Throws, rolling back, on any mismatch. */
export async function restoreTenant(client, tenantId, data) {
  const { manifest, rows } = data;
  if (manifest.tenantId !== tenantId) {
    throw new Error(`the export belongs to tenant ${manifest.tenantId}, not ${tenantId}`);
  }
  const { rows: v } = await client.query("SELECT public.backup_schema_version() AS version");
  if (v[0].version !== manifest.schemaVersion) {
    throw new Error(
      `the export is from schema ${manifest.schemaVersion} and the database is at ${v[0].version}: restore it on the same schema version`,
    );
  }
  const { rows: tables } = await client.query("SELECT * FROM public.tenant_backup_tables()");
  const names = tables.map((t) => t.table_name);
  if (names.length !== manifest.tables.length || names.some((n) => !manifest.tables.includes(n))) {
    throw new Error("the tables covered by the export differ from this database's");
  }
  const q = (name) => client.escapeIdentifier(name);

  await client.query("BEGIN");
  try {
    // Foreign keys are checked in bulk before COMMIT instead of row by row.
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("SET LOCAL lock_timeout = '10s'");

    const exportedAudit = rows.get("audit_logs").map((r) => JSON.parse(r).id);
    const { rows: newer } = await client.query(
      "SELECT to_jsonb(a)::text AS r FROM public.audit_logs a WHERE a.tenant_id = $1 AND NOT (a.id = ANY($2::uuid[]))",
      [tenantId, exportedAudit],
    );

    for (const t of [...tables].reverse()) {
      if (t.parent_table) {
        await client.query(
          `DELETE FROM public.${q(t.table_name)} c USING public.${q(t.parent_table)} p
           WHERE p.id = c.${q(t.parent_column)} AND p.tenant_id = $1`,
          [tenantId],
        );
      } else if (t.table_name === "tenants") {
        await client.query("DELETE FROM public.tenants WHERE id = $1", [tenantId]);
      } else {
        await client.query(`DELETE FROM public.${q(t.table_name)} WHERE tenant_id = $1`, [tenantId]);
      }
    }

    for (const t of tables) {
      const list = rows.get(t.table_name);
      for (let i = 0; i < list.length; i += BATCH) {
        await client.query(
          `INSERT INTO public.${q(t.table_name)} SELECT * FROM jsonb_populate_recordset(NULL::public.${q(t.table_name)}, $1::jsonb)`,
          [`[${list.slice(i, i + BATCH).join(",")}]`],
        );
      }
    }

    // Audit entries written after the export stay when their user still exists.
    let kept = [];
    if (newer.length > 0) {
      const res = await client.query(
        `INSERT INTO public.audit_logs
         SELECT r.* FROM jsonb_populate_recordset(NULL::public.audit_logs, $1::jsonb) r
         WHERE EXISTS (SELECT 1 FROM public.users u WHERE u.tenant_id = r.tenant_id AND u.id = r.user_id)
         RETURNING id`,
        [`[${newer.map((n) => n.r).join(",")}]`],
      );
      kept = res.rows.map((r) => r.id);
    }
    const dropped = newer.map((n) => n.r).filter((r) => !kept.includes(JSON.parse(r).id));

    for (const t of tables) {
      const scope = t.parent_table
        ? `FROM public.${q(t.table_name)} c JOIN public.${q(t.parent_table)} p ON p.id = c.${q(t.parent_column)} WHERE p.tenant_id = $1`
        : t.table_name === "tenants"
          ? "FROM public.tenants WHERE id = $1"
          : `FROM public.${q(t.table_name)} WHERE tenant_id = $1`;
      const { rows: c } = await client.query(`SELECT count(*)::int AS n ${scope}`, [tenantId]);
      const expected = rows.get(t.table_name).length + (t.table_name === "audit_logs" ? kept.length : 0);
      if (c[0].n !== expected) throw new Error(`count mismatch in ${t.table_name}: ${c[0].n} instead of ${expected}`);
    }

    const broken = await foreignKeyOrphans(client);
    if (broken.length > 0) throw new Error(`the restore would leave broken foreign keys: ${broken.join(", ")}`);

    await client.query("COMMIT");
    const counts = Object.fromEntries([...rows].map(([table, list]) => [table, list.length]));
    return { counts, keptAuditEntries: kept.length, droppedAuditEntries: dropped };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      tenant: { type: "string" },
      file: { type: "string" },
      "db-url": { type: "string", default: LOCAL_DB_URL },
    },
  });
  if (!values.tenant || !UUID.test(values.tenant)) throw new Error("--tenant <uuid> is required");
  if (!values.file) throw new Error("--file <export.gz> is required");
  const dbUrl = assertLocalDbUrl(values["db-url"]);

  const data = await readExport(values.file);
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const result = await restoreTenant(client, values.tenant, data);
    const report = `${values.file}.restore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(
      report,
      JSON.stringify({ tenantId: values.tenant, restoredAt: new Date().toISOString(), ...result }, null, 2),
      { mode: 0o600 },
    );
    const rowsTotal = Object.values(result.counts).reduce((a, b) => a + b, 0);
    console.log(`restored tenant ${values.tenant}: ${rowsTotal} rows from ${values.file}`);
    console.log(
      `audit entries after the export: ${result.keptAuditEntries} kept, ${result.droppedAuditEntries.length} moved to ${report}`,
    );
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
