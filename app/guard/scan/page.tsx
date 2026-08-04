import type { Metadata } from 'next';
import { requireGuardOrAdmin } from '@/lib/auth/authorize';
import { getLocale } from '@/lib/theme';
import { getDictionary } from '@/lib/i18n/dictionary';
import { PageHeading } from '@/components/ui/surface';
import { Scanner } from './scanner';

export const metadata: Metadata = { title: 'Scan pass' };
export const dynamic = 'force-dynamic';

export default async function GuardScanPage() {
  await requireGuardOrAdmin('/guard/scan');
  const locale = await getLocale();
  const t = getDictionary(locale);

  return (
    <>
      <PageHeading title={t.scanHeading} description={t.scanInstruction} />
      <Scanner t={t} />
    </>
  );
}
