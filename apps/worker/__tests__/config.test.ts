import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const url = "postgresql://worker_app:secret@db:5432/postgres";
const env = {
  WORKER_DATABASE_URL: url,
  SMTP_HOST: "mailpit",
  SMTP_PORT: "1025",
  EMAIL_FROM: "no-reply@scaliahr.localhost",
  APP_BASE_URL: "http://localhost:3000",
  BACKUP_DIR: "/backups",
};

describe("loadConfig", () => {
  it("accepts a postgres connection URL and the email settings", () => {
    expect(loadConfig(env)).toEqual({
      databaseUrl: url,
      email: {
        smtp: { host: "mailpit", port: 1025 },
        from: "no-reply@scaliahr.localhost",
        appBaseUrl: "http://localhost:3000",
      },
      backupDir: "/backups",
    });
  });

  it.each(Object.keys(env))("rejects a missing %s", (name) => {
    const partial: Record<string, string> = { ...env };
    delete partial[name];
    expect(() => loadConfig(partial)).toThrow(new RegExp(name));
  });

  it.each([
    ["SMTP_PORT", "smtp"],
    ["EMAIL_FROM", "not-an-address"],
    ["APP_BASE_URL", "javascript:alert(1)"],
    ["BACKUP_DIR", "backups"],
  ])("rejects an invalid %s", (name, value) => {
    expect(() => loadConfig({ ...env, [name]: value })).toThrow(new RegExp(name));
  });

  it("rejects a URL that is not postgres:// and never echoes its value", () => {
    const bad = "https://worker_app:s3cr3t-value@example.com/db";
    let message = "";
    try {
      loadConfig({ ...env, WORKER_DATABASE_URL: bad });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/WORKER_DATABASE_URL/);
    expect(message).not.toContain("s3cr3t-value");
  });
});
