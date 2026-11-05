import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { startWorker } from "./worker.js";

const boss = await startWorker(loadConfig());
log("info", "worker.started");

let stopping = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  log("info", "worker.stopping", { signal });
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
