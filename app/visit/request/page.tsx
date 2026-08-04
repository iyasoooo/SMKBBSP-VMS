import type { Metadata } from 'next';
import Link from 'next/link';
import {
  listActiveDestinations,
  listActiveVisitTypes,
  listAvailableTeachers,
} from '@/lib/domain/appointments';
import { getSettings } from '@/lib/domain/settings';
import { addDays, toIsoDayString } from '@/lib/time';
import { Alert } from '@/components/ui/surface';
import { RequestForm } from './request-form';

export const metadata: Metadata = { title: 'Request a visit' };

// Teacher availability and settings change during the day; never cache this.
export const dynamic = 'force-dynamic';

function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export default async function RequestVisitPage() {
  const [settings, teachers, destinations, visitTypes] = await Promise.all([
    getSettings(),
    listAvailableTeachers(),
    listActiveDestinations(),
    listActiveVisitTypes(),
  ]);

  const now = new Date();

  // The date picker is bounded by the same rules the server enforces, so the
  // common mistakes are prevented before a submission is attempted.
  const minDate = toIsoDayString(addDays(now, settings.minLeadMinutes >= 1440 ? 1 : 0));
  const maxDate = toIsoDayString(addDays(now, settings.maxAdvanceDays));

  const canSubmit = teachers.length > 0 && visitTypes.length > 0;

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Request a visit</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Complete this form to ask a teacher for an appointment. You do not need an account. Your
          host teacher will approve or decline the request, and we will email you either way.
        </p>
      </div>

      {!canSubmit ? (
        <Alert tone="warning" title="Requests are not available right now">
          No teachers are currently accepting visit requests. Please contact the school office
          directly, or come to the guard house during visiting hours (
          {formatMinutes(settings.openMinutes)} to {formatMinutes(settings.closeMinutes)}).
        </Alert>
      ) : (
        <RequestForm
          teachers={teachers.map((teacher) => ({
            id: teacher.id,
            name: teacher.name,
            department: teacher.teacherProfile?.department ?? 'School staff',
          }))}
          destinations={destinations.map((destination) => ({
            id: destination.id,
            nameEn: destination.nameEn,
            instructionsEn: destination.instructionsEn,
          }))}
          visitTypes={visitTypes.map((type) => ({
            id: type.id,
            nameEn: type.nameEn,
            defaultDurationMinutes: type.defaultDurationMinutes,
            requiresIdSighted: type.requiresIdSighted,
          }))}
          openingTime={formatMinutes(settings.openMinutes)}
          closingTime={formatMinutes(settings.closeMinutes)}
          minDate={minDate}
          maxDate={maxDate}
          consentVersion={settings.consentVersion}
        />
      )}

      <p className="mt-8 text-center text-xs text-muted">
        Already submitted a request?{' '}
        <Link href="/visit/status" className="underline underline-offset-2">
          Find out how to check its status
        </Link>
        .
      </p>
    </>
  );
}
