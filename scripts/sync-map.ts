/**
 * Write the school map into whichever database `DATABASE_URL` points at.
 *
 * Run with `npm run map:sync`. Unlike `npm run db:seed` this is safe in
 * production and is meant to run there: the map is the school's floor plan, not
 * demonstration data, and a deployment without it serves a wayfinding page with
 * nothing to draw.
 *
 * The compose stack runs it straight after `prisma migrate deploy`, in the same
 * one-shot container, so a fresh deployment comes up with the map already in
 * place. Running it again is harmless.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The script runs outside Next.js, so .env must be loaded explicitly.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

import { PrismaClient } from '@prisma/client';
import { syncSchoolMap } from '@/lib/map/sync';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await syncSchoolMap(prisma, (message) => console.warn(`  ! ${message}`));
    console.log(
      `School map synced: ${result.levels} levels, ${result.nodes} nodes, ${result.edges} edges.`,
    );
    console.log(
      `Destinations: ${result.bound} curated bound to rooms, ${result.derived} derived from rooms.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('School map sync failed:', error);
  process.exit(1);
});
