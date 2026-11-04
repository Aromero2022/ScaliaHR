import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRANDING,
  EmailJobSchema,
  assertAppUrl,
  contrastRatio,
  renderEmail,
  resolveBranding,
  type EmailJob,
  type EmailJobInput,
} from "../src/index.js";

const APP = { appBaseUrl: "http://localhost:3000" };
const tenantId = "a0000000-0000-0000-0000-000000000001";

function job<T extends EmailJobInput>(input: T): Extract<EmailJob, { template: T["template"] }> {
  return EmailJobSchema.parse(input) as Extract<EmailJob, { template: T["template"] }>;
}

const invitation = job({
  template: "invitation",
  tenantId,
  to: "ana@acme.test",
  data: { acceptUrl: "http://acme-corp.localhost:3000/invite/t1", inviterName: "Elena", inviteeName: "Ana" },
});
const reset = job({
  template: "password_reset",
  tenantId,
  to: "ana@acme.test",
  data: { resetUrl: "http://localhost:3000/reset/t2", expiresInMinutes: 30 },
});
const notification = job({
  template: "notification",
  tenantId,
  to: "ana@acme.test",
  data: { title: "Tu solicitud fue aprobada", body: "Primer párrafo.\n\nSegundo párrafo.", actionUrl: "http://localhost:3000/requests/9" },
});

describe("templates", () => {
  it("renders the invitation in Spanish by default", async () => {
    const r = await renderEmail(invitation, { tenantName: "Acme Corp" }, APP);
    expect(r.subject).toBe("Acme Corp te invitó a ScaliaHR");
    expect(r.text).toContain("Elena te invitó a unirte a Acme Corp en ScaliaHR.");
    expect(r.text).toContain("El enlace vence en 72 horas.");
    expect(r.html).toContain('href="http://acme-corp.localhost:3000/invite/t1"');
    expect(r.html).toContain('lang="es"');
  });

  it("renders the invitation in English", async () => {
    const r = await renderEmail({ ...invitation, locale: "en" }, { tenantName: "Acme Corp" }, APP);
    expect(r.subject).toBe("Acme Corp invited you to ScaliaHR");
    expect(r.text).toContain("Elena invited you to join Acme Corp on ScaliaHR.");
  });

  it("renders the password reset in both languages", async () => {
    const es = await renderEmail(reset, { tenantName: "Acme Corp" }, APP);
    expect(es.subject).toBe("Restablece tu contraseña de Acme Corp");
    expect(es.text).toContain("El enlace vence en 30 minutos.");
    const en = await renderEmail({ ...reset, locale: "en" }, { tenantName: "Acme Corp" }, APP);
    expect(en.subject).toBe("Reset your Acme Corp password");
    expect(en.html).toContain('href="http://localhost:3000/reset/t2"');
  });

  it("renders a notification with one paragraph per block and a default action label", async () => {
    const r = await renderEmail(notification, { tenantName: "Acme Corp" }, APP);
    expect(r.subject).toBe("Tu solicitud fue aprobada");
    expect(r.text).toContain("Primer párrafo.");
    expect(r.text).toContain("Segundo párrafo.");
    expect(r.text).toContain("Ver en ScaliaHR");
  });

  it("falls back to the tenant's platform locale, then Spanish", async () => {
    const en = await renderEmail(reset, { tenantName: "Acme Corp", locale: "en" }, APP);
    expect(en.subject).toBe("Reset your Acme Corp password");
    const es = await renderEmail(reset, null, APP);
    expect(es.subject).toBe("Restablece tu contraseña de ScaliaHR");
  });

  it("escapes HTML coming from job data", async () => {
    const r = await renderEmail(
      { ...notification, data: { ...notification.data, body: '<script>alert("x")</script>' } },
      null,
      APP,
    );
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
  });
});

describe("branding", () => {
  it("uses the ScaliaHR brand when the tenant has none", async () => {
    const r = await renderEmail(invitation, null, APP);
    expect(r.html).toContain(DEFAULT_BRANDING.primaryColor);
    expect(r.text).toContain("ScaliaHR");
  });

  it("uses the tenant's primary color and logo", async () => {
    const r = await renderEmail(invitation, { tenantName: "Acme Corp", primaryColor: "#0F766E", logoUrl: "https://cdn.acme.test/logo.png" }, APP);
    expect(r.html).toContain("#0F766E");
    expect(r.html).toContain('src="https://cdn.acme.test/logo.png"');
    expect(r.html).toContain('alt="Acme Corp"');
  });

  it("ignores logos that are not http(s) and invalid colors", () => {
    const b = resolveBranding({ tenantName: "Acme", logoUrl: "javascript:alert(1)", primaryColor: "red" });
    expect(b.logoUrl).toBeNull();
    expect(b.primaryColor).toBe(DEFAULT_BRANDING.primaryColor);
  });

  it("picks button text with at least 4.5:1 contrast, or falls back to the default color", () => {
    const yellow = resolveBranding({ primaryColor: "#FACC15" });
    expect(yellow.buttonTextColor).toBe("#111827");
    expect(contrastRatio(yellow.primaryColor, yellow.buttonTextColor)).toBeGreaterThanOrEqual(4.5);

    const gray = resolveBranding({ primaryColor: "#777777" });
    expect(gray.primaryColor).toBe(DEFAULT_BRANDING.primaryColor);
    expect(contrastRatio(gray.primaryColor, gray.buttonTextColor)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("links", () => {
  it("allows the app origin and its tenant subdomains", () => {
    expect(assertAppUrl("http://localhost:3000/x", APP.appBaseUrl)).toBe("http://localhost:3000/x");
    expect(assertAppUrl("http://acme.localhost:3000/x", APP.appBaseUrl)).toBe("http://acme.localhost:3000/x");
  });

  it.each([
    "https://evil.example/reset",
    "http://localhost.evil.example:3000/x",
    "http://localhost:4000/x",
    "https://localhost:3000/x",
    "http://user:pass@localhost:3000/x",
  ])("rejects %s", (url) => {
    expect(() => assertAppUrl(url, APP.appBaseUrl)).toThrow();
  });

  it("refuses to render a job whose link leaves the app", async () => {
    const evil = { ...reset, data: { ...reset.data, resetUrl: "https://evil.example/reset" } };
    await expect(renderEmail(evil, null, APP)).rejects.toThrow(/outside the app origin/);
  });
});

describe("job contract", () => {
  it("applies defaults", () => {
    const parsed = EmailJobSchema.parse({ template: "invitation", tenantId, to: "a@b.test", data: { acceptUrl: "http://localhost:3000/i" } });
    expect(parsed.template === "invitation" && parsed.data.expiresInHours).toBe(72);
  });

  it.each([
    { template: "invitation", tenantId, to: "not-an-email", data: { acceptUrl: "http://localhost:3000/i" } },
    { template: "welcome", tenantId, to: "a@b.test", data: {} },
    { template: "password_reset", tenantId: "nope", to: "a@b.test", data: { resetUrl: "http://localhost:3000/r" } },
    { template: "password_reset", tenantId, to: "a@b.test", data: { resetUrl: "ftp://localhost/r" } },
    { template: "notification", tenantId, to: "a@b.test", data: { title: "T", body: "B", actionLabel: "Go" } },
    { template: "notification", tenantId, to: "a@b.test", locale: "fr", data: { title: "T", body: "B" } },
  ])("rejects an invalid job %#", (input) => {
    expect(EmailJobSchema.safeParse(input).success).toBe(false);
  });
});
