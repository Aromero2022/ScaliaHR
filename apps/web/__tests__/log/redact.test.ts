import { describe, expect, it } from "vitest";
import { redact, redactString, REDACTED, serializeError } from "@/lib/log/redact";

describe("redaction (D27)", () => {
  it("blanks sensitive keys at any depth, whatever the value", () => {
    expect(
      redact({
        password: "hunter2",
        user: { email: "ana@acme.test", rfc: "XAXX010101000", curp: "x", nss: 1, clabe: "y", salary: 50000 },
        headers: { authorization: "Bearer abc", cookie: "sb=1", "x-api-key": "k" },
        accessToken: "t",
      }),
    ).toEqual({
      password: REDACTED,
      user: { email: "ana@acme.test", rfc: REDACTED, curp: REDACTED, nss: REDACTED, clabe: REDACTED, salary: REDACTED },
      headers: { authorization: REDACTED, cookie: REDACTED, "x-api-key": REDACTED },
      accessToken: REDACTED,
    });
  });

  it.each([
    ["Key (rfc)=(GODE561231GR8) already exists", "Key (rfc)=([RFC]) already exists"],
    ["curp GODE561231HDFRRN09 duplicated", "curp [CURP] duplicated"],
    ["clabe 012180001234567891 rejected", "clabe [CLABE] rejected"],
    ["nss 12345678901 invalid", "nss [NSS] invalid"],
    ["card 4111111111111111", "card [NUMBER]"],
    ["Authorization: Bearer abc.def-123", "Authorization: Bearer [REDACTED]"],
    ["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_123 leaked", "token [JWT] leaked"],
  ])("masks values inside free text: %s", (input, expected) => {
    expect(redactString(input)).toBe(expected);
  });

  it("leaves ids, dates and ordinary text alone", () => {
    const text = "tenant a0000000-0000-0000-0000-000000000001 at 2026-11-05T10:00:00Z: duplicate key value";
    expect(redactString(text)).toBe(text);
  });

  it("serializes errors with redacted message and stack", () => {
    const error = Object.assign(new Error("duplicate rfc GODE561231GR8"), { code: "23505", digest: "123" });
    const out = serializeError(error);
    expect(out).toMatchObject({ name: "Error", message: "duplicate rfc [RFC]", code: "23505", digest: "123" });
    expect(String(out.stack)).not.toContain("GODE561231GR8");
  });

  it("serializes Supabase error objects the same way", () => {
    expect(serializeError({ message: "bad", details: "Key (rfc)=(GODE561231GR8)", hint: null, code: "23505" })).toEqual({
      message: "bad",
      details: "Key (rfc)=([RFC])",
      hint: null,
      code: "23505",
    });
  });
});
