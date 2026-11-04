import { describe, expect, it } from "vitest";
import { integrationEnv } from "./helpers/env";

// The health check against the real local database, through the same
// non-BYPASSRLS Prisma role the app uses.
const env = integrationEnv();
process.env.DATABASE_URL = env.prismaDbUrl;

const { GET } = await import("@/app/api/health/route");

describe("GET /api/health against the local database", () => {
  it("reports the app and the database as ok", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", checks: { app: "ok", database: "ok" } });
  });
});
