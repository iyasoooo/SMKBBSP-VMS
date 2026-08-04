/**
 * Development helper: mint a session cookie for a seeded demo account.
 *
 *   npx tsx scripts/smoke-session.ts guard@smkbbsp.test
 *
 * Prints the raw cookie value so a page can be fetched from the command line
 * during smoke testing. It creates a real, revocable session row - it does not
 * bypass authentication. Development only.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

import { PrismaClient } from '@prisma/client';
import { generateToken, hashSessionToken } from '@/lib/crypto/tokens';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to mint a smoke-test session in production.');
  }

  const email = process.argv[2] ?? 'guard@smkbbsp.test';
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No such user: ${email}`);

  const rawToken = generateToken();
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userAgentLabel: 'Desktop',
    },
  });

  console.log(rawToken);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
