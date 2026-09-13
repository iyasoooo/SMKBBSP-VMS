import type { Metadata } from 'next';
import { requireGuardOrAdmin } from '@/lib/auth/authorize';
import {
  listActiveDestinations,
  listActiveVisitTypes,
  listAvailableTeachers,
} from '@/lib/domain/appointments';
import { getLocale } from '@/lib/theme';
import { getDictionary } from '@/lib/i18n/dictionary';
import { Alert, Card, PageHeading } from '@/components/ui/surface';
import { WalkInForm } from './walk-in-form';

export const metadata: Metadata = { title: 'Walk-in registration' };
export const dynamic = 'force-dynamic';

export default async function WalkInPage() {
  await requireGuardOrAdmin('/guard/walk-in');
  const [locale, teachers, destinations, visitTypes] = await Promise.all([
    getLocale(),
    listAvailableTeachers(),
    listActiveDestinations(),
    listActiveVisitTypes(),
  ]);
  const t = getDictionary(locale);

  if (teachers.length === 0 || visitTypes.length === 0) {
    return (
      <>
        <PageHeading title={t.walkInHeading} description={t.walkInSubtitle} />
        <Alert tone="warning" title="Registration unavailable">
          No active host teachers or visit types are configured. Ask an administrator to set them up
          before registering walk-in visitors.
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeading title={t.walkInHeading} description={t.walkInSubtitle} />

      <Card className="p-5 sm:p-6">
        <WalkInForm
          t={t}
          options={{
            teachers: teachers.map((teacher) => ({
              id: teacher.id,
              name: teacher.name,
              department: teacher.teacherProfile?.department ?? 'Staff',
            })),
            destinations: destinations.map((destination) => ({
              id: destination.id,
              nameEn: destination.nameEn,
              nameMs: destination.nameMs,
              block: destination.mapNode?.block ?? null,
              levelName: destination.mapNode?.level.nameEn ?? null,
            })),
            visitTypes: visitTypes.map((type) => ({
              id: type.id,
              nameEn: type.nameEn,
              defaultDurationMinutes: type.defaultDurationMinutes,
              requiresIdSighted: type.requiresIdSighted,
            })),
          }}
        />
      </Card>
    </>
  );
}
