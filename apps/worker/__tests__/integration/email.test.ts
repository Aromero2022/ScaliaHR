import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { PgBoss } from "pg-boss";
import type { EmailJobInput } from "@scaliahr/email";
// The producer the web app uses (apps/web/src/lib/email), so this suite covers
// the whole path: web → email.send → worker → SMTP adapter → Mailpit (D20).
import { createEmailQueue } from "../../../web/src/lib/email/index.js";
import { QUEUES } from "../../src/queues.js";
import { startWorker } from "../../src/worker.js";

function localUrl(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing: source scripts/supabase-test-env.sh first.`);
  if (!["127.0.0.1", "localhost"].includes(new URL(value).hostname)) {
    throw new Error(`${name} must point to the local Supabase stack`);
  }
  return value;
}

const workerUrl = localUrl("WORKER_TEST_DB_URL");
const enqueuerUrl = localUrl("EMAIL_ENQUEUER_TEST_DB_URL");
const adminUrl = localUrl("SUPABASE_TEST_DB_URL");
const mailpitUrl = localUrl("MAILPIT_URL");
const smtpPort = Number(process.env.MAILPIT_SMTP_PORT);
if (!Number.isInteger(smtpPort)) throw new Error("MAILPIT_SMTP_PORT is missing: source scripts/supabase-test-env.sh first.");

const APP = "http://localhost:3000";
const admin = new pg.Client({ connectionString: adminUrl });
const queue = createEmailQueue(enqueuerUrl);
const tenants = { branded: randomUUID(), plain: randomUUID(), suspended: randomUUID() };
const mailpitIds: string[] = [];
let worker: PgBoss;

interface MailpitMessage {
  ID: string;
  Subject: string;
  From: { Address: string };
  To: { Address: string }[];
  HTML: string;
  Text: string;
}

async function messagesTo(address: string): Promise<{ ID: string }[]> {
  const res = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  return ((await res.json()) as { messages: { ID: string }[] }).messages;
}

async function finalState(id: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const job = await worker.getJobById(QUEUES.email, id);
    if (job && ["completed", "failed"].includes(job.state)) return job.state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`email job ${id} did not finish`);
}

/** Enqueues through the web producer and returns what Mailpit received. */
async function deliver(job: Omit<EmailJobInput, "to">): Promise<{ to: string; messages: MailpitMessage[] }> {
  const to = `it-${randomUUID()}@example.test`;
  const id = await queue.enqueue({ ...job, to } as EmailJobInput);
  expect(await finalState(id)).toBe("completed");
  const found = await messagesTo(to);
  mailpitIds.push(...found.map((m) => m.ID));
  const messages = await Promise.all(
    found.map(async (m) => (await (await fetch(`${mailpitUrl}/api/v1/message/${m.ID}`)).json()) as MailpitMessage),
  );
  return { to, messages };
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(
    `INSERT INTO public.tenants (id, name, slug, suspended_at) VALUES
       ($1, 'Mailpit Branded', $4, NULL),
       ($2, 'Mailpit Plain', $5, NULL),
       ($3, 'Mailpit Suspended', $6, now())`,
    [tenants.branded, tenants.plain, tenants.suspended, ...Object.values(tenants).map((id) => `it-${id.slice(0, 8)}`)],
  );
  await admin.query(
    `INSERT INTO public.system_configurations (tenant_id, key, value_json) VALUES
       ($1, 'company.branding', '{"logoUrl":"https://cdn.example.test/logo.png","primaryColor":"#0F766E"}'),
       ($1, 'platform.locale', '"es"'),
       ($2, 'platform.locale', '"en"')`,
    [tenants.branded, tenants.plain],
  );
  worker = await startWorker({
    databaseUrl: workerUrl,
    email: { smtp: { host: "127.0.0.1", port: smtpPort }, from: "no-reply@scaliahr.localhost", appBaseUrl: APP },
  });
});

afterAll(async () => {
  await queue.stop();
  await worker?.stop({ graceful: true, timeout: 5_000 });
  if (mailpitIds.length > 0) {
    await fetch(`${mailpitUrl}/api/v1/messages`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ IDs: mailpitIds }),
    });
  }
  const ids = Object.values(tenants);
  await admin.query("DELETE FROM public.system_configurations WHERE tenant_id = ANY($1::uuid[])", [ids]);
  await admin.query("DELETE FROM public.tenants WHERE id = ANY($1::uuid[])", [ids]);
  await admin.end();
});

describe("each template reaches Mailpit (D20)", () => {
  it("invitation, in the tenant's locale and with its logo and color", async () => {
    const { to, messages } = await deliver({
      template: "invitation",
      tenantId: tenants.branded,
      data: { acceptUrl: "http://it-branded.localhost:3000/invite/abc", inviterName: "Elena" },
    });
    expect(messages).toHaveLength(1);
    const [m] = messages;
    expect(m.Subject).toBe("Mailpit Branded te invitó a ScaliaHR");
    expect(m.From.Address).toBe("no-reply@scaliahr.localhost");
    expect(m.To.map((r) => r.Address)).toEqual([to]);
    expect(m.HTML).toContain('src="https://cdn.example.test/logo.png"');
    expect(m.HTML).toContain("#0F766E");
    expect(m.HTML).toContain('href="http://it-branded.localhost:3000/invite/abc"');
    expect(m.Text).toContain("Elena te invitó a unirte a Mailpit Branded en ScaliaHR.");
  });

  it("password reset, with the ScaliaHR brand when the tenant has none", async () => {
    const { messages } = await deliver({
      template: "password_reset",
      tenantId: tenants.plain,
      data: { resetUrl: `${APP}/reset/xyz`, expiresInMinutes: 30 },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].Subject).toBe("Reset your Mailpit Plain password");
    expect(messages[0].HTML).toContain("#4F46E5");
    expect(messages[0].Text).toContain("The link expires in 30 minutes.");
  });

  it("generic notification, with the job's locale over the tenant's", async () => {
    const { messages } = await deliver({
      template: "notification",
      tenantId: tenants.plain,
      locale: "es",
      data: { title: "Tu solicitud fue aprobada", body: "Ya puedes verla.", actionUrl: `${APP}/requests/9` },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].Subject).toBe("Tu solicitud fue aprobada");
    expect(messages[0].Text).toContain("Ver en ScaliaHR");
  });
});

describe("tenants that cannot receive email (D21)", () => {
  it.each([
    ["suspended", () => tenants.suspended],
    ["nonexistent", () => randomUUID()],
  ])("drops the email of a %s tenant without sending anything", async (_label, tenantId) => {
    const { messages } = await deliver({
      template: "password_reset",
      tenantId: tenantId(),
      data: { resetUrl: `${APP}/reset/xyz` },
    });
    expect(messages).toEqual([]);
  });
});
