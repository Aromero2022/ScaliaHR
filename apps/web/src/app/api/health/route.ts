import { prisma } from "@/lib/db/tenant-client";

// Public on purpose: container healthchecks and uptime probes call it without a
// session, so it is excluded from the middleware matcher and reveals nothing
// beyond ok/error per check.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DB_TIMEOUT_MS = 2_000;

type CheckStatus = "ok" | "error";

async function checkDatabase(): Promise<CheckStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("database check timed out")), DB_TIMEOUT_MS);
      }),
    ]);
    return "ok";
  } catch (error) {
    // Only the error class: driver messages can carry hosts or connection details.
    console.error(`[health] database check failed: ${error instanceof Error ? error.name : "unknown"}`);
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(): Promise<Response> {
  const database = await checkDatabase();
  const healthy = database === "ok";
  return Response.json(
    { status: healthy ? "ok" : "error", checks: { app: "ok", database } },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
