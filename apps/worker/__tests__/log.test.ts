import { describe, expect, it, vi } from "vitest";
import { errorFields, log, mask } from "../src/log.js";

describe("worker JSON logs (D27)", () => {
  it("writes one JSON object per line with the job's ids", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    log("info", "job.completed", { queue: "email.send", jobId: "j1", tenantId: "t1", outcome: "sent" });
    expect(JSON.parse(String(out.mock.calls[0][0]))).toEqual({
      time: expect.any(String),
      level: "info",
      event: "job.completed",
      queue: "email.send",
      jobId: "j1",
      tenantId: "t1",
      outcome: "sent",
    });
    out.mockRestore();
  });

  it("masks tokens and Mexican identifiers in error messages", () => {
    expect(mask("rfc GODE561231GR8, curp GODE561231HDFRRN09, clabe 012180001234567891")).toBe(
      "rfc [RFC], curp [CURP], clabe [CLABE]",
    );
    expect(errorFields(Object.assign(new Error("Key (rfc)=(GODE561231GR8)"), { code: "23505" }))).toEqual({
      name: "Error",
      message: "Key (rfc)=([RFC])",
      code: "23505",
    });
  });

  it("masks the recipient an SMTP rejection quotes", () => {
    const smtp = errorFields(new Error("550 5.1.1 <ana.lopez@acme.dev>: user unknown"));
    expect(JSON.stringify(smtp)).not.toContain("ana.lopez@acme.dev");
    expect(smtp).toEqual({ name: "Error", message: "550 5.1.1 <[EMAIL]>: user unknown" });
  });

  it("masks an address before the number masks can split it", () => {
    expect(mask("12345678901@acme.dev")).toBe("[EMAIL]");
  });

  it("masks a bearer token in an error message", () => {
    const bearer = errorFields(new Error("Authorization: Bearer abc.def.ghi"));
    expect(JSON.stringify(bearer)).not.toContain("abc.def.ghi");
    expect(bearer).toEqual({ name: "Error", message: "Authorization: Bearer [REDACTED]" });
  });
});
