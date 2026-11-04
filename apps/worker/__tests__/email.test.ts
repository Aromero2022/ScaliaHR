import { describe, expect, it, vi } from "vitest";
import type { EmailTransport, OutgoingEmail } from "@scaliahr/email";
import { deliverEmail, type EmailDeps } from "../src/email.js";

const tenantId = "a0000000-0000-0000-0000-000000000001";

function deps(branding: EmailDeps["branding"]) {
  const sent: OutgoingEmail[] = [];
  const transport: EmailTransport = {
    send: vi.fn(async (email: OutgoingEmail) => {
      sent.push(email);
      return { messageId: "m1" };
    }),
    close: vi.fn(async () => {}),
  };
  return { sent, deps: { branding, transport, from: "no-reply@scaliahr.localhost", appBaseUrl: "http://localhost:3000" } };
}

const reset = {
  template: "password_reset",
  tenantId,
  to: "ana@acme.test",
  data: { resetUrl: "http://localhost:3000/reset/t" },
};

describe("deliverEmail", () => {
  it("renders with the tenant's branding and sends through the transport", async () => {
    const { sent, deps: d } = deps(async () => ({ tenantName: "Acme Corp", primaryColor: "#0F766E", locale: "en" }));
    await expect(deliverEmail(reset, d)).resolves.toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: "no-reply@scaliahr.localhost", to: "ana@acme.test", subject: "Reset your Acme Corp password" });
    expect(sent[0].html).toContain("#0F766E");
  });

  it("drops the email when the tenant does not exist or is suspended", async () => {
    const { sent, deps: d } = deps(async () => null);
    await expect(deliverEmail(reset, d)).resolves.toBe("dropped");
    expect(sent).toEqual([]);
  });

  it("rejects an invalid job before looking up the tenant", async () => {
    const branding = vi.fn(async () => ({ tenantName: "Acme Corp" }));
    const { sent, deps: d } = deps(branding);
    await expect(deliverEmail({ ...reset, to: "not-an-email" }, d)).rejects.toThrow();
    expect(branding).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("refuses a link outside the app origin", async () => {
    const { sent, deps: d } = deps(async () => ({ tenantName: "Acme Corp" }));
    const evil = { ...reset, data: { resetUrl: "https://evil.example/reset" } };
    await expect(deliverEmail(evil, d)).rejects.toThrow(/outside the app origin/);
    expect(sent).toEqual([]);
  });
});
