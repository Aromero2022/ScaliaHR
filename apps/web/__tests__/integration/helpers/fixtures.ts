import { randomUUID } from "node:crypto";
import type { Client } from "pg";

export interface ColumnMeta {
  name: string;
  sqlType: string;
  typeName: string;
  category: string;
  enumLabels: string[];
  notNull: boolean;
  hasDefault: boolean;
  maxLength: number | null;
  checkDefs: string[];
}

export interface ForeignKey {
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
}

export interface TableMeta {
  name: string;
  columns: ColumnMeta[];
  foreignKeys: ForeignKey[];
}

export type Row = Record<string, unknown>;

export interface StoredFixture {
  ctid: string;
  row: Row;
}

export async function tenantScopedTables(pg: Client): Promise<string[]> {
  const { rows } = await pg.query<{ table_name: string }>(`
    SELECT c.relname::text AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND a.attname = 'tenant_id'
      AND NOT a.attisdropped
    ORDER BY c.relname`);
  return rows.map((r) => r.table_name);
}

export async function loadTableMeta(pg: Client, table: string): Promise<TableMeta> {
  const { rows: columns } = await pg.query<{
    name: string;
    sql_type: string;
    type_name: string;
    category: string;
    enum_labels: string[] | null;
    not_null: boolean;
    has_default: boolean;
    max_length: number | null;
    check_defs: string[] | null;
  }>(
    `
    SELECT a.attname::text AS name,
           format_type(a.atttypid, a.atttypmod) AS sql_type,
           bt.typname::text AS type_name,
           bt.typcategory::text AS category,
           (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
              FROM pg_enum e WHERE e.enumtypid = bt.oid) AS enum_labels,
           (a.attnotnull OR t.typnotnull) AS not_null,
           (a.atthasdef OR a.attidentity <> '' OR a.attgenerated <> '' OR t.typdefault IS NOT NULL) AS has_default,
           CASE WHEN a.atttypmod > 4 AND bt.typcategory = 'S' THEN a.atttypmod - 4 END AS max_length,
           (SELECT array_agg(pg_get_constraintdef(con.oid))
              FROM pg_constraint con
             WHERE con.conrelid = a.attrelid AND con.contype = 'c'
               AND con.conkey = ARRAY[a.attnum]) AS check_defs
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
    JOIN pg_type bt ON bt.oid = CASE WHEN t.typtype = 'd' THEN t.typbasetype ELSE t.oid END
    WHERE a.attrelid = format('public.%I', $1::text)::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum`,
    [table],
  );

  const { rows: fks } = await pg.query<{
    columns: string[];
    ref_schema: string;
    ref_table: string;
    ref_columns: string[];
  }>(
    `
    SELECT array(SELECT att.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
                 ORDER BY k.ord) AS columns,
           rn.nspname::text AS ref_schema,
           rc.relname::text AS ref_table,
           array(SELECT att.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = k.attnum
                 ORDER BY k.ord) AS ref_columns
    FROM pg_constraint con
    JOIN pg_class rc ON rc.oid = con.confrelid
    JOIN pg_namespace rn ON rn.oid = rc.relnamespace
    WHERE con.conrelid = format('public.%I', $1::text)::regclass AND con.contype = 'f'`,
    [table],
  );

  return {
    name: table,
    columns: columns.map((c) => ({
      name: c.name,
      sqlType: c.sql_type,
      typeName: c.type_name,
      category: c.category,
      enumLabels: c.enum_labels ?? [],
      notNull: c.not_null,
      hasDefault: c.has_default,
      maxLength: c.max_length,
      checkDefs: c.check_defs ?? [],
    })),
    foreignKeys: fks.map((f) => ({
      columns: f.columns,
      refSchema: f.ref_schema,
      refTable: f.ref_table,
      refColumns: f.ref_columns,
    })),
  };
}

function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 10);
}

function checkLiteral(col: ColumnMeta): string | undefined {
  for (const def of col.checkDefs) {
    if (/~\*?/.test(def)) continue;
    const match = def.match(/'((?:[^']|'')*)'::/);
    if (match) return match[1].replace(/''/g, "'");
  }
  return undefined;
}

// Values are JSON-compatible so the same row can go to PostgREST and,
// through explicit casts, to pg.
export function valueForColumn(col: ColumnMeta): unknown {
  if (col.category === "E") return col.enumLabels[0];
  if (col.category === "A") return [];
  if (col.category === "S") {
    const literal = checkLiteral(col);
    if (literal !== undefined) return literal;
    const base = col.name.includes("email") ? `rls-${shortId()}@example.test` : `rls-${shortId()}`;
    return col.maxLength !== null ? base.slice(0, col.maxLength) : base;
  }
  switch (col.typeName) {
    case "uuid":
      return randomUUID();
    case "bool":
      return false;
    case "int2":
    case "int4":
    case "int8":
    case "numeric":
    case "float4":
    case "float8":
      return 1;
    case "date":
      return "2026-01-01";
    case "timestamp":
    case "timestamptz":
      return "2026-01-01T00:00:00Z";
    case "time":
    case "timetz":
      return "00:00:00";
    case "interval":
      return "1 day";
    case "json":
    case "jsonb":
      return col.checkDefs.some((d) => d.includes("'array'")) ? [] : {};
    case "inet":
    case "cidr":
      return "127.0.0.1";
    case "bytea":
      return "\\x00";
    case "daterange":
      return "[2026-01-01,2026-12-31)";
    case "tstzrange":
    case "tsrange":
      return "[2026-01-01 00:00:00+00,2026-12-31 00:00:00+00)";
  }
  throw new Error(`No fixture value for column ${col.name} of type ${col.sqlType}`);
}

export interface RowContext {
  tenantId: string;
  authUserId: string;
  fixtures: Map<string, StoredFixture>;
  overrides?: Row;
}

// Builds a row that satisfies NOT NULL columns; NOT NULL foreign keys point
// at rows of the same tenant whenever such a row exists.
export function buildRow(meta: TableMeta, ctx: RowContext): Row {
  const row: Row = {};
  const fkValue = new Map<string, unknown>();
  for (const fk of meta.foreignKeys) {
    fk.columns.forEach((column, i) => {
      const refColumn = fk.refColumns[i];
      let value: unknown;
      if (fk.refSchema === "auth" && fk.refTable === "users") value = ctx.authUserId;
      else if (fk.refSchema === "public" && fk.refTable === "tenants") value = ctx.tenantId;
      else if (fk.refSchema === "public" && fk.refTable !== meta.name) {
        value = ctx.fixtures.get(fk.refTable)?.row[refColumn];
      }
      if (value !== undefined && value !== null && !fkValue.has(column)) fkValue.set(column, value);
    });
  }

  for (const col of meta.columns) {
    if (col.name === "tenant_id") {
      row[col.name] = ctx.tenantId;
    } else if (fkValue.has(col.name) && col.notNull) {
      row[col.name] = fkValue.get(col.name);
    } else if (col.notNull && !col.hasDefault) {
      row[col.name] = valueForColumn(col);
    }
  }
  return { ...row, ...ctx.overrides };
}

function sqlParam(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 0 ? "{}" : value;
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

export async function insertRow(
  pg: Client,
  meta: TableMeta,
  row: Row,
  { bypassForeignKeys }: { bypassForeignKeys: boolean },
): Promise<StoredFixture> {
  const names = Object.keys(row);
  const types = new Map(meta.columns.map((c) => [c.name, c.sqlType]));
  const columnList = names.map((n) => `"${n}"`).join(", ");
  const values = names.map((n, i) => `$${i + 1}::${types.get(n)}`).join(", ");
  const sql =
    names.length > 0
      ? `INSERT INTO public."${meta.name}" AS t (${columnList}) VALUES (${values}) RETURNING t.ctid::text AS ctid, to_jsonb(t) AS row`
      : `INSERT INTO public."${meta.name}" AS t DEFAULT VALUES RETURNING t.ctid::text AS ctid, to_jsonb(t) AS row`;

  await pg.query("BEGIN");
  try {
    if (bypassForeignKeys) await pg.query("SET LOCAL session_replication_role = replica");
    const { rows } = await pg.query<{ ctid: string; row: Row }>(sql, names.map((n) => sqlParam(row[n])));
    await pg.query("COMMIT");
    return rows[0];
  } catch (error) {
    await pg.query("ROLLBACK");
    throw new Error(`Could not insert fixture into public.${meta.name}: ${(error as Error).message}`);
  }
}

// Parents before children, following NOT NULL foreign keys between the given tables.
export function orderByDependencies(metas: TableMeta[]): TableMeta[] {
  const byName = new Map(metas.map((m) => [m.name, m]));
  const ordered: TableMeta[] = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (meta: TableMeta) => {
    if (state.get(meta.name)) return;
    state.set(meta.name, "visiting");
    const notNull = new Set(meta.columns.filter((c) => c.notNull).map((c) => c.name));
    for (const fk of meta.foreignKeys) {
      const parent = fk.refSchema === "public" ? byName.get(fk.refTable) : undefined;
      if (parent && parent !== meta && fk.columns.some((c) => notNull.has(c))) visit(parent);
    }
    state.set(meta.name, "done");
    ordered.push(meta);
  };

  metas.forEach(visit);
  return ordered;
}
