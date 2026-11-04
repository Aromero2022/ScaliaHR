import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { PgBoss } from "pg-boss";
import { createBoss } from "../../src/boss.js";
import { QUEUES } from "../../src/queues.js";
import { startWorker } from "../../src/worker.js";

const url = process.env.WORKER_TEST_DB_URL;
if (!url) {
  throw new Error("WORKER_TEST_DB_URL is missing: source scripts/supabase-test-env.sh first.");
}
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("WORKER_TEST_DB_URL must point to the local Supabase stack");
}

const opened: PgBoss[] = [];
afterAll(async () => {
  await Promise.all(opened.map((boss) => boss.stop({ graceful: false })));
});

async function client(): Promise<PgBoss> {
  const boss = createBoss(url!, { supervise: false });
  await boss.start();
  opened.push(boss);
  return boss;
}

async function waitForFinalState(boss: PgBoss, queue: string, id: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await boss.getJobById(queue, id);
    if (job && (job.state === "completed" || job.state === "failed")) return job;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`job ${id} in ${queue} did not finish within ${timeoutMs} ms`);
}

describe("worker against the local queue (D17)", () => {
  it("only uses queues declared by migrations", async () => {
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
      const { rows } = await db.query<{ name: string }>("SELECT name FROM pgboss.queue");
      const declared = rows.map((r) => r.name);
      for (const name of Object.values(QUEUES)) {
        expect(declared, `queue ${name} is not declared in supabase/migrations`).toContain(name);
      }
    } finally {
      await db.end();
    }
  });

  it("processes system.ping while maintenance runs with worker_app's privileges", async () => {
    const errors: string[] = [];
    const worker = await startWorker(
      { databaseUrl: url },
      { superviseIntervalSeconds: 1, maintenanceIntervalSeconds: 1, monitorIntervalSeconds: 1 },
    );
    opened.push(worker);
    worker.on("error", (error: Error) => errors.push(error.message));

    const sender = await client();
    const id = await sender.send(QUEUES.ping, { source: "integration-test" });
    expect(id).toBeTruthy();

    const job = await waitForFinalState(sender, QUEUES.ping, id!, 30_000);
    // Give supervise/maintenance a few passes against the real grants and RLS.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await worker.stop({ graceful: true, timeout: 5_000 });

    expect(job.state).toBe("completed");
    expect(errors).toEqual([]);
  });

  it("retries a failing job and then moves it to the dead letter queue", async () => {
    const boss = await client();
    await boss.work(QUEUES.ping, async () => {
      throw new Error("forced failure");
    });

    const marker = randomUUID();
    const id = await boss.send(QUEUES.ping, { marker });
    const job = await waitForFinalState(boss, QUEUES.ping, id!, 45_000);
    await boss.offWork(QUEUES.ping);

    expect(job.state).toBe("failed");
    expect(job.retryCount).toBe(2);

    const dead = await boss.fetch<{ marker?: string }>(QUEUES.deadLetter, { batchSize: 100 });
    expect(dead.some((d) => d.data?.marker === marker)).toBe(true);
  });
});
