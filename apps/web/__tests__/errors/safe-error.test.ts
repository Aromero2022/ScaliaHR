import { beforeEach, describe, expect, it, vi } from "vitest";

const headerValues = new Map<string, string>();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => headerValues) }));

import { GENERIC_ERROR, safeError } from "@/lib/errors/safe-error";

const err = vi.spyOn(console, "error").mockImplementation(() => {});
beforeEach(() => {
  vi.clearAllMocks();
  headerValues.clear();
});

describe("safeError (D27)", () => {
  it("logs the detail with request and tenant id and returns only a generic message with the code", async () => {
    headerValues.set("x-request-id", "req-123").set("x-tenant-id", "tenant-9");
    const dbError = { message: 'duplicate key value violates unique constraint "users_rfc_key"', details: "Key (rfc)=(GODE561231GR8) already exists.", code: "23505" };

    const message = await safeError("ec.personal_change", dbError);

    expect(message).toBe(`${GENERIC_ERROR} Código: req-123`);
    expect(message).not.toMatch(/duplicate|constraint|GODE/);
    const line = JSON.parse(String(err.mock.calls[0][0]));
    expect(line).toMatchObject({
      level: "error",
      event: "ec.personal_change",
      requestId: "req-123",
      tenantId: "tenant-9",
      error: { code: "23505", details: "Key (rfc)=([RFC]) already exists." },
    });
  });

  it("accepts a specific user message and works without request headers", async () => {
    expect(await safeError("employees.list", new Error("x"), "No se pudo cargar la lista.")).toBe("No se pudo cargar la lista.");
  });
});
