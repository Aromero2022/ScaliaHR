import { loadConfig } from "./config.js";
import { startWorker } from "./worker.js";

const boss = await startWorker(loadConfig());
console.log("[worker] started");

let stopping = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal} received, finishing active jobs`);
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
