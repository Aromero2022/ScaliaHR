import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "@/lib/log/logger";
import { reportError, setErrorReporter, jsonLogReporter } from "@/lib/log/report";

const out = vi.spyOn(console, "log").mockImplementation(() => {});
const err = vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => {
  vi.clearAllMocks();
  setErrorReporter(jsonLogReporter);
});

function lastLine(spy: typeof out) {
  return JSON.parse(String(spy.mock.calls.at(-1)?.[0]));
}

describe("JSON logger (D27)", () => {
  it("writes one JSON object per line with time, level, event and the request ids", () => {
    log("info", "employees.listed", { count: 3 }, { requestId: "r-1", tenantId: "t-1" });
    expect(lastLine(out)).toEqual({
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      level: "info",
      event: "employees.listed",
      requestId: "r-1",
      tenantId: "t-1",
      count: 3,
    });
  });

  it("sends warn and error to stderr and redacts fields", () => {
    log("error", "x", { password: "p", note: "rfc GODE561231GR8" });
    expect(out).not.toHaveBeenCalled();
    expect(lastLine(err)).toMatchObject({ level: "error", password: "[REDACTED]", note: "rfc [RFC]" });
  });

  it("omits ids that are unknown", () => {
    log("info", "boot");
    expect(Object.keys(lastLine(out)).sort()).toEqual(["event", "level", "time"]);
  });
});

describe("error reporter adapter (D27)", () => {
  it("logs the error as JSON by default", () => {
    reportError("arco.create", new Error("boom"), { requestId: "r-2", tenantId: "t-2" }, { step: "insert" });
    expect(lastLine(err)).toMatchObject({
      level: "error",
      event: "arco.create",
      requestId: "r-2",
      tenantId: "t-2",
      step: "insert",
      error: { name: "Error", message: "boom" },
    });
  });

  it("can be swapped (Phase 23: Sentry) without touching callers", () => {
    const report = vi.fn();
    setErrorReporter({ report });
    reportError("e", new Error("x"), { requestId: "r" });
    expect(report).toHaveBeenCalledWith("e", expect.any(Error), { requestId: "r" }, undefined);
    expect(err).not.toHaveBeenCalled();
  });
});
