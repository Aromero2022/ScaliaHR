import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("accepts a postgres connection URL", () => {
    const url = "postgresql://worker_app:secret@db:5432/postgres";
    expect(loadConfig({ WORKER_DATABASE_URL: url })).toEqual({ databaseUrl: url });
  });

  it("rejects a missing WORKER_DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(/WORKER_DATABASE_URL/);
  });

  it("rejects a URL that is not postgres:// and never echoes its value", () => {
    const url = "https://worker_app:s3cr3t-value@example.com/db";
    let message = "";
    try {
      loadConfig({ WORKER_DATABASE_URL: url });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/WORKER_DATABASE_URL/);
    expect(message).not.toContain("s3cr3t-value");
  });
});
