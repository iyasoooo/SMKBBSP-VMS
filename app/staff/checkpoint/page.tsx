import type { Metadata } from 'next';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/authorize';
import { getSettings } from '@/lib/domain/settings';
import { getLocale } from '@/lib/theme';
import { getDictionary } from '@/lib/i18n/dictionary';
import { Alert, PageHeading } from '@/components/ui/surface';
import { CheckpointScanner } from './scanner';

export const metadata: Metadata = { title: 'Confirm a visitor' };
export const dynamic = 'force-dynamic';

/**
 * Staff checkpoint screen.
 *
 * Open to guards, administrators and teachers. A teacher reaching it can only
 * ever record against their own visitor - the service re-scopes by `teacherId`
 * - so widening the route does not widen what any one person can see.
 *
 * PRINCIPAL is absent by design: that role observes and does not write.
 */
export default async function CheckpointPage() {
  await requireRole([Role.GUARD, Role.ADMIN, Role.TEACHER], '/staff/checkpoint');

  const [settings, locale, destinations] = await Promise.all([
    getSettings(),
    getLocale(),
    prisma.destination.findMany({
      where: { isActive: true },
      orderBy: { nameEn: 'asc' },
      select: { id: true, nameEn: true, nameMs: true },
    }),
  ]);

  const t = getDictionary(locale);

  if (!settings.checkpointEnabled) {
    return (
      <>
        <PageHeading title={t.checkpointHeading} />
        <Alert tone="info">{t.confirmationsOff}</Alert>
      </>
    );
  }

  const options = destinations.map((destination) => ({
    id: destination.id,
    name: locale === 'ms' ? destination.nameMs : destination.nameEn,
  }));

  return (
    <>
      <PageHeading title={t.checkpointHeading} description={t.checkpointInstruction} />
      <CheckpointScanner t={t} destinations={options} defaultDestinationId={null} />
    </>
  );
}
