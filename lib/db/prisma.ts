import { PrismaClient } from '@prisma/client';
import { getEnv } from '@/lib/env';

/**
 * Prisma client singleton.
 *
 * Next.js dev mode re-evaluates modules on every hot reload, which would open
 * a new connection pool each time and eventually exhaust PostgreSQL's
 * connection slots. Caching on `globalThis` survives the reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const env = getEnv();
  return new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    datasources: { db: { url: env.DATABASE_URL } },
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (getEnv().NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * The transaction client type. Services accept this so they can be composed
 * inside a larger `prisma.$transaction(...)` without opening a nested one.
 */
export type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type Db = PrismaClient | TxClient;
