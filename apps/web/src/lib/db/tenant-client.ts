import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type TenantContext = {
  tenantId: string;
  role?: string;
};

export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const claims = JSON.stringify({
      tenant_id: ctx.tenantId,
      app_role: ctx.role ?? "member",
    });

    await tx.$executeRawUnsafe(`SET LOCAL role TO 'authenticated'`);
    await tx.$executeRawUnsafe(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      claims
    );

    return fn(tx as unknown as PrismaClient);
  });
}

export type { PrismaClient };
export { prisma, Prisma };
