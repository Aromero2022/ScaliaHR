// Asks the running worker for one per-tenant export (D23) and waits for it:
//   node dist/export-tenant.js <tenant-id>
// Prints the path of the file, inside the worker's backup volume.
import { createBoss } from "./boss.js";
import type { TenantExport } from "./backup.js";
import { TenantExportJob } from "./backup.js";
import { loadConfig } from "./config.js";
import { QUEUES } from "./queues.js";

const TIMEOUT_MS = 10 * 60_000;

const data = TenantExportJob.parse({ tenantId: process.argv[2] });
const boss = createBoss(loadConfig().databaseUrl, { supervise: false });
await boss.start();

let exitCode = 1;
try {
  const id = await boss.send(QUEUES.tenantExport, data);
  if (!id) throw new Error("send() returned no job id");

  const deadline = Date.now() + TIMEOUT_MS;
  let job = await boss.getJobById<typeof data>(QUEUES.tenantExport, id);
  while (Date.now() < deadline && job && !["completed", "failed"].includes(job.state)) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    job = await boss.getJobById<typeof data>(QUEUES.tenantExport, id);
  }

  if (job?.state === "completed") {
    const output = job.output as TenantExport;
    console.log(`[export] ${output.rows} rows -> ${output.path}`);
    exitCode = 0;
  } else {
    console.error(`[export] job ${id} ended in state "${job?.state ?? "unknown"}"`);
  }
} finally {
  await boss.stop({ graceful: false });
}
process.exit(exitCode);
