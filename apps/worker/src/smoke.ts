// Sends one system.ping job and waits until the running worker completes it.
// Used by scripts/local-up.sh and CI to prove the worker is consuming the queue.
import { createBoss } from "./boss.js";
import { loadConfig } from "./config.js";
import { QUEUES } from "./queues.js";

const TIMEOUT_MS = 60_000;

const boss = createBoss(loadConfig().databaseUrl, { supervise: false });
await boss.start();

let exitCode = 1;
try {
  const id = await boss.send(QUEUES.ping, { source: "smoke" });
  if (!id) throw new Error("send() returned no job id");

  const deadline = Date.now() + TIMEOUT_MS;
  let state: string | undefined;
  while (Date.now() < deadline) {
    state = (await boss.getJobById(QUEUES.ping, id))?.state;
    if (state === "completed" || state === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (state === "completed") {
    console.log(`[smoke] ${QUEUES.ping} ${id} completed`);
    exitCode = 0;
  } else {
    console.error(`[smoke] ${QUEUES.ping} ${id} ended in state "${state ?? "unknown"}"`);
  }
} finally {
  await boss.stop({ graceful: false });
}
process.exit(exitCode);
