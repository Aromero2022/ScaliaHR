import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/db/tenant-client", () => ({ prisma: { $queryRaw: queryRaw } }));

import { GET } from "@/app/api/health/route";

const DB_TIMEOUT_MS = 2_000;

let logged: string[];

beforeEach(() => {
  queryRaw.mockReset();
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("returns 200 when the database answers", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", checks: { app: "ok", database: "ok" } });
  });

  it("returns 503 without leaking the database error", async () => {
    const secret = "postgresql://prisma_app:hunter2@db.internal:5432/postgres";
    queryRaw.mockRejectedValue(new Error(`Can't reach database server at ${secret}`));
    const res = await GET();
    const text = await res.text();

    expect(res.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ status: "error", checks: { app: "ok", database: "error" } });
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("db.internal");
    expect(logged.join("\n")).not.toContain("hunter2");
    expect(logged.join("\n")).not.toContain("db.internal");
  });

  it("returns 503 when the database does not answer in time", async () => {
    vi.useFakeTimers();
    queryRaw.mockReturnValue(new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(DB_TIMEOUT_MS);
    const res = await pending;
    expect(res.status).toBe(503);
    expect((await res.json()).checks.database).toBe("error");
  });

  it("is never cached", async () => {
    queryRaw.mockResolvedValue([]);
    expect((await GET()).headers.get("Cache-Control")).toBe("no-store");
    queryRaw.mockRejectedValue(new Error("down"));
    expect((await GET()).headers.get("Cache-Control")).toBe("no-store");
  });

  it("exposes only the status and per-check results", async () => {
    queryRaw.mockResolvedValue([]);
    const body = await (await GET()).json();
    expect(Object.keys(body).sort()).toEqual(["checks", "status"]);
    expect(Object.keys(body.checks).sort()).toEqual(["app", "database"]);
  });
});
