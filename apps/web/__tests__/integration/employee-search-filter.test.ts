import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";
import { ilikeAnyOf } from "@/lib/postgrest/filters";

/**
 * D28 — the employee search goes into a PostgREST or() filter. Built from a
 * raw string, a search could add conditions; quoted, it is only text.
 * Runs the same query as employees/page.tsx against local PostgREST.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);
let tenant: TestTenant;

const COLUMNS = ["first_name", "last_name", "email", "employee_id"] as const;
const INJECTION = "a,id.eq.1)(";
// Would match every row if it were read as filters: id.not.is.null is always true.
const WIDENING = "zzz,id.not.is.null,first_name.ilike.zzz";

beforeAll(async () => {
  tenant = await world.createTenant();
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

function search(filter: string) {
  return tenant.admin.client.from("users").select("first_name").is("deleted_at", null).or(filter);
}

/** The filter as employees/page.tsx built it before D28. */
function rawFilter(text: string) {
  return COLUMNS.map((column) => `${column}.ilike.%${text}%`).join(",");
}

describe("employee search filter (D28)", () => {
  it("raw: the search text was read as filters", async () => {
    const injected = await search(rawFilter(INJECTION));
    // PostgREST ran the injected id.eq.1 and failed casting "1" to uuid.
    expect(injected.error?.code).toBe("22P02");

    const widened = await search(rawFilter(WIDENING));
    expect(widened.error).toBeNull();
    expect(widened.data).toHaveLength(3);
  });

  it(`quoted: "${INJECTION}" adds no condition`, async () => {
    const { data, error } = await search(ilikeAnyOf(COLUMNS, INJECTION));
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("quoted: a search shaped like filters matches nothing", async () => {
    const { data, error } = await search(ilikeAnyOf(COLUMNS, WIDENING));
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("quoted: plain searches still find people, and % is plain text", async () => {
    const all = await search(ilikeAnyOf(COLUMNS, "integration"));
    expect(all.error).toBeNull();
    expect(all.data).toHaveLength(3);

    const one = await search(ilikeAnyOf(COLUMNS, "manag"));
    expect(one.data).toEqual([{ first_name: "manager" }]);

    const percent = await search(ilikeAnyOf(COLUMNS, "%"));
    expect(percent.error).toBeNull();
    expect(percent.data).toEqual([]);
  });
});
