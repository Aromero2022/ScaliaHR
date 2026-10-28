import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { MODULE_FLAG_KEYS } from "@/lib/tenant/module-flags";

/**
 * tenants.is_*_active columns are the single source of truth for module
 * flags; the app's MODULE_FLAG_KEYS must list exactly those columns.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
afterAll(() => db.end());

describe("module flags", () => {
  it("MODULE_FLAG_KEYS matches the tenants is_*_active columns", async () => {
    const { rows } = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(`
      SELECT column_name::text, data_type::text, is_nullable::text
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name LIKE 'is\\_%\\_active'`);
    expect(rows.map((r) => r.column_name).sort()).toEqual([...MODULE_FLAG_KEYS].sort());
    for (const row of rows) {
      expect(row, row.column_name).toMatchObject({ data_type: "boolean" });
    }
  });
});
