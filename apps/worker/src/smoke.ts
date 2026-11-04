// Sends one job and waits until the running worker completes it. Used by
// scripts/local-up.sh and CI to prove the worker is consuming the queue:
//   node dist/smoke.js               system.ping
//   node dist/smoke.js email <to>    a notification for the demo tenant (D20),
//                                    which local-up then looks for in Mailpit
import { EmailJobSchema } from "@scaliahr/email";
import { createBoss } from "./boss.js";
import { loadConfig } from "./config.js";
import { QUEUES } from "./queues.js";

const TIMEOUT_MS = 60_000;
// Acme Corp from supabase/seed.sql.
const DEMO_TENANT_ID = "a0000000-0000-0000-0000-000000000001";

const [mode = "ping", to] = process.argv.slice(2);
const queue = mode === "email" ? QUEUES.email : QUEUES.ping;
const data =
  mode === "email"
    ? EmailJobSchema.parse({
        template: "notification",
        tenantId: DEMO_TENANT_ID,
        to,
        data: { title: "ScaliaHR local: prueba de correo", body: "El worker entregó este correo en Mailpit." },
      })
    : { source: "smoke" };

const boss = createBoss(loadConfig().databaseUrl, { supervise: false });
await boss.start();

let exitCode = 1;
try {
  const id = await boss.send(queue, data);
  if (!id) throw new Error("send() returned no job id");

  const deadline = Date.now() + TIMEOUT_MS;
  let state: string | undefined;
  while (Date.now() < deadline) {
    state = (await boss.getJobById(queue, id))?.state;
    if (state === "completed" || state === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (state === "completed") {
    console.log(`[smoke] ${queue} ${id} completed`);
    exitCode = 0;
  } else {
    console.error(`[smoke] ${queue} ${id} ended in state "${state ?? "unknown"}"`);
  }
} finally {
  await boss.stop({ graceful: false });
}
process.exit(exitCode);
