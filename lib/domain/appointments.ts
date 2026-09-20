import {
  AppointmentSource,
  AppointmentStatus,
  type IdentityType,
  Role,
  type VisitorCategory,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  buildIdentityFields,
  computeIdentityHmac,
  normalizeIdentity,
  validateNormalizedIdentity,
} from '@/lib/crypto/identity';
import { generateReferenceNumber, generateToken, hashToken } from '@/lib/crypto/tokens';
import { normalizeEmail, normalizeName, normalizePhone } from '@/lib/domain/contact';
import { checkBlacklist } from '@/lib/domain/blacklist';
import { getSettings, type SchoolSettings } from '@/lib/domain/settings';
import { queueInAppNotification } from '@/lib/domain/in-app-notifications';
import { recordAudit } from '@/lib/audit';
import { AUDIT_ACTIONS, PUBLIC_TOKEN_TRAILING_DAYS } from '@/lib/constants';
import {
  addDays,
  formatDateTime,
  minutesSinceZonedMidnight,
  parseIsoDayString,
  parseTimeString,
  zonedDayOfWeek,
  zonedTimeToUtc,
} from '@/lib/time';
import type { AppointmentRequestInput } from '@/lib/validation/appointment';

/**
 * Appointment creation.
 *
 * Everything that decides whether a request may exist happens here, on the
 * server, inside one transaction: schedule rules, host availability, blacklist
 * evaluation, visitor de-duplication, token issue, and in-app notifications.
 */

export interface CreateAppointmentResult {
  referenceNumber: string;
  /**
   * Raw private token. Returned once so the caller can send the visitor to
   * their private page, which is the only place it is ever shown. Never
   * stored, logged, or put in a notification.
   */
  rawToken: string;
  status: AppointmentStatus;
}

export type ScheduleErrorCode =
  | 'PAST_DATE'
  | 'TOO_SOON'
  | 'TOO_FAR'
  | 'CLOSED_DAY'
  | 'BEFORE_HOURS'
  | 'AFTER_HOURS'
  | 'INVALID_DATE'
  | 'INVALID_TIME';

export class ScheduleError extends Error {
  constructor(
    readonly code: ScheduleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ScheduleError';
  }
}

export class HostUnavailableError extends Error {
  constructor(message = 'That teacher is not accepting visits at the moment.') {
    super(message);
    this.name = 'HostUnavailableError';
  }
}

/**
 * Validate the requested slot against the school calendar.
 *
 * Returns the UTC instants for storage. All comparisons are made in Malaysian
 * wall-clock terms, because "before 07:30" means 07:30 in Kuala Lumpur
 * regardless of where the server runs.
 */
export function resolveSchedule(
  visitDate: string,
  visitTime: string,
  durationMinutes: number,
  settings: SchoolSettings,
  now: Date = new Date(),
): { scheduledStart: Date; scheduledEnd: Date } {
  const day = parseIsoDayString(visitDate);
  if (!day) throw new ScheduleError('INVALID_DATE', 'Choose a valid date.');

  const time = parseTimeString(visitTime);
  if (!time) throw new ScheduleError('INVALID_TIME', 'Choose a valid time.');

  const scheduledStart = zonedTimeToUtc({ ...day, hour: time.hour, minute: time.minute });
  const scheduledEnd = new Date(scheduledStart.getTime() + durationMinutes * 60_000);

  if (scheduledStart.getTime() <= now.getTime()) {
    throw new ScheduleError('PAST_DATE', 'Choose a date and time in the future.');
  }

  const leadMinutes = (scheduledStart.getTime() - now.getTime()) / 60_000;
  if (leadMinutes < settings.minLeadMinutes) {
    throw new ScheduleError(
      'TOO_SOON',
      `Requests must be made at least ${settings.minLeadMinutes} minutes in advance. For an urgent visit, please come to the guard house.`,
    );
  }

  if (scheduledStart.getTime() > addDays(now, settings.maxAdvanceDays).getTime()) {
    throw new ScheduleError(
      'TOO_FAR',
      `You can only book up to ${settings.maxAdvanceDays} days ahead.`,
    );
  }

  if (!settings.openDays.includes(zonedDayOfWeek(scheduledStart))) {
    throw new ScheduleError('CLOSED_DAY', 'The school is closed to visitors on that day.');
  }

  const startMinutes = minutesSinceZonedMidnight(scheduledStart);
  if (startMinutes < settings.openMinutes) {
    throw new ScheduleError(
      'BEFORE_HOURS',
      `Visits start from ${formatMinutes(settings.openMinutes)}. Choose a later time.`,
    );
  }

  // The whole visit must finish inside opening hours, not just start inside.
  const endMinutes = minutesSinceZonedMidnight(scheduledEnd);
  const endsNextDay = scheduledEnd.getTime() - scheduledStart.getTime() > 24 * 60 * 60 * 1000;
  if (endsNextDay || endMinutes > settings.closeMinutes || endMinutes < startMinutes) {
    throw new ScheduleError(
      'AFTER_HOURS',
      `Visits must finish by ${formatMinutes(settings.closeMinutes)}. Choose an earlier time or a shorter visit.`,
    );
  }

  return { scheduledStart, scheduledEnd };
}

function formatMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Find an existing visitor for this person, or create one.
 *
 * De-duplication is keyed on the identity HMAC alone. Matching on name or
 * email would be unsafe: two people can share a name, and a shared family
 * email address is common, so a looser rule would merge distinct people into
 * one record and expose one visitor's history to another.
 */
async function upsertVisitor(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  input: {
    fullName: string;
    email: string | null;
    phone: string | null;
    identityType: IdentityType;
    identityNumber: string;
    visitorCategory: VisitorCategory;
    consentVersion: string;
  },
): Promise<string> {
  const normalized = normalizeIdentity(input.identityType, input.identityNumber);
  const validation = validateNormalizedIdentity(input.identityType, normalized);
  if (!validation.ok) {
    throw new Error(`Invalid identity value (${validation.code ?? 'UNKNOWN'})`);
  }

  const identityHmac = computeIdentityHmac(input.identityType, normalized);

  const existing = await tx.visitor.findFirst({
    where: { identityHmac, identityType: input.identityType },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (existing) {
    // Refresh the details this person just gave us; they are more current.
    await tx.visitor.update({
      where: { id: existing.id },
      data: {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        visitorCategory: input.visitorCategory,
        consentVersion: input.consentVersion,
        consentedAt: new Date(),
      },
    });
    return existing.id;
  }

  const identity = buildIdentityFields(input.identityType, input.identityNumber);
  const created = await tx.visitor.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      visitorCategory: input.visitorCategory,
      identityType: input.identityType,
      identityCiphertext: identity.ciphertext,
      identityIv: identity.iv,
      identityTag: identity.tag,
      identityKeyVersion: identity.keyVersion,
      identityHmac: identity.hmac,
      identityLast4: identity.last4,
      consentVersion: input.consentVersion,
      consentedAt: new Date(),
    },
    select: { id: true },
  });

  return created.id;
}

/**
 * Create a public appointment request.
 *
 * A blacklist BLOCK or REVIEW does not reject the submission outright. The
 * request is stored as REVIEW_REQUIRED and administrators are alerted, while
 * the visitor sees the ordinary confirmation. Telling a blocked person that
 * they are blocked, at submission time, would both disclose restricted
 * information and let them probe the list.
 */
export async function createAppointmentRequest(
  input: AppointmentRequestInput,
  now: Date = new Date(),
): Promise<CreateAppointmentResult> {
  const settings = await getSettings();

  const [teacher, visitType, destination] = await Promise.all([
    prisma.user.findFirst({
      where: { id: input.teacherId, role: Role.TEACHER, isActive: true },
      include: { teacherProfile: true },
    }),
    prisma.visitType.findFirst({ where: { id: input.visitTypeId, isActive: true } }),
    input.destinationId
      ? prisma.destination.findFirst({ where: { id: input.destinationId, isActive: true } })
      : Promise.resolve(null),
  ]);

  if (!teacher || !teacher.teacherProfile?.isAcceptingVisits) throw new HostUnavailableError();
  if (!visitType) throw new HostUnavailableError('That visit type is no longer available.');
  if (input.destinationId && !destination) {
    throw new HostUnavailableError('That destination is no longer available.');
  }

  const { scheduledStart, scheduledEnd } = resolveSchedule(
    input.visitDate,
    input.visitTime,
    visitType.defaultDurationMinutes,
    settings,
    now,
  );

  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const fullName = normalizeName(input.fullName);
  const normalizedIdentity = normalizeIdentity(input.identityType, input.identityNumber);

  const blacklist = await checkBlacklist(
    { identityType: input.identityType, normalizedIdentity, email, phone },
    prisma,
    now,
  );

  /*
   * Companions are screened too.
   *
   * Checking only the person who filled the form would leave an obvious way
   * past the blacklist: a blocked individual simply arrives as somebody else's
   * guest. Any hit on any attendee routes the whole request to review, because
   * the party arrives together and the school is admitting all of them.
   */
  /*
   * Defaulted here rather than relied upon from the caller. The schema fills
   * this in when a submission is parsed, but the service is also called
   * directly - by tests and by the walk-in path - and a missing array should
   * mean "nobody else is coming", not a crash.
   */
  const companionInputs = input.companions ?? [];

  const companionChecks = await Promise.all(
    companionInputs.map((companion) =>
      checkBlacklist(
        {
          identityType: companion.identityType,
          normalizedIdentity: normalizeIdentity(companion.identityType, companion.identityNumber),
          phone: companion.phone ?? null,
        },
        prisma,
        now,
      ),
    ),
  );

  const needsReview =
    blacklist.decision !== 'CLEAR' || companionChecks.some((check) => check.decision !== 'CLEAR');
  const rawToken = generateToken();
  const referenceNumber = generateReferenceNumber(now);

  const result = await prisma.$transaction(async (tx) => {
    const visitorId = await upsertVisitor(tx, {
      fullName,
      email,
      phone,
      identityType: input.identityType,
      identityNumber: input.identityNumber,
      visitorCategory: input.visitorCategory,
      consentVersion: settings.consentVersion,
    });

    const appointment = await tx.appointment.create({
      data: {
        companions: {
          create: companionInputs.map((companion) => {
            const identity = buildIdentityFields(companion.identityType, companion.identityNumber);
            return {
              fullName: normalizeName(companion.fullName),
              phone: normalizePhone(companion.phone ?? null),
              relation: normalizeName(companion.relation),
              identityType: companion.identityType,
              identityCiphertext: identity.ciphertext,
              identityIv: identity.iv,
              identityTag: identity.tag,
              identityKeyVersion: identity.keyVersion,
              identityHmac: identity.hmac,
              identityLast4: identity.last4,
            };
          }),
        },
        referenceNumber,
        source: AppointmentSource.ONLINE,
        visitorId,
        teacherId: teacher.id,
        destinationId: destination?.id ?? null,
        visitTypeId: visitType.id,
        scheduledStart,
        scheduledEnd,
        purpose: input.purpose,
        partySize: input.partySize,
        vehicleNumber: input.vehicleNumber ?? null,
        status: needsReview ? AppointmentStatus.REVIEW_REQUIRED : AppointmentStatus.PENDING,
        publicTokenHash: hashToken(rawToken),
        publicTokenExpiresAt: addDays(scheduledEnd, PUBLIC_TOKEN_TRAILING_DAYS),
      },
    });

    const scheduledAt = formatDateTime(scheduledStart);

    /*
     * Nothing is sent to the visitor. They are redirected to their private
     * page, which is the acknowledgement, and it reads the same whether or not
     * the request was held for review.
     */

    if (needsReview) {
      // Alert every administrator; the host teacher is deliberately not told,
      // because a review outcome may end with the request never reaching them.
      const admins = await tx.user.findMany({
        where: { role: Role.ADMIN, isActive: true },
        select: { id: true },
      });

      for (const admin of admins) {
        // No reason or blacklist detail is included.
        await queueInAppNotification(
          {
            userId: admin.id,
            type: 'admin.review_required',
            title: 'A visit request needs review',
            body: `Reference ${referenceNumber}, requested for ${scheduledAt}.`,
            link: `/admin/appointments/${appointment.id}`,
          },
          tx,
        );
      }
    } else {
      await queueInAppNotification(
        {
          userId: teacher.id,
          type: 'teacher.new_request',
          title: 'New visit request awaiting your decision',
          body: `${fullName} has asked to meet you on ${scheduledAt}.`,
          link: `/teacher/requests/${appointment.id}`,
        },
        tx,
      );
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.APPOINTMENT_CREATED,
        targetType: 'Appointment',
        targetId: appointment.id,
        metadata: {
          reference: referenceNumber,
          source: AppointmentSource.ONLINE,
          status: appointment.status,
          blacklistDecision: blacklist.decision,
          teacherId: teacher.id,
        },
      },
      tx,
    );

    return { appointment };
  });

  return {
    referenceNumber,
    rawToken,
    status: result.appointment.status,
  };
}

/** Active teachers a visitor may choose as a host. */
export async function listAvailableTeachers() {
  return prisma.user.findMany({
    where: {
      role: Role.TEACHER,
      isActive: true,
      teacherProfile: { isAcceptingVisits: true },
    },
    select: {
      id: true,
      name: true,
      teacherProfile: { select: { department: true } },
    },
    orderBy: { name: 'asc' },
  });
}

export async function listActiveDestinations() {
  return prisma.destination.findMany({
    where: { isActive: true },
    select: {
      id: true,
      nameEn: true,
      nameMs: true,
      instructionsEn: true,
      instructionsMs: true,
      /*
       * Block and level, for telling apart the many rooms that share a name.
       * The school has several "Bilik Sains", and a list that shows only the
       * name asks the visitor to guess which one they were told to go to.
       */
      mapNode: {
        select: { block: true, level: { select: { nameEn: true, nameMs: true } } },
      },
    },
    orderBy: { nameEn: 'asc' },
  });
}

export async function listActiveVisitTypes() {
  return prisma.visitType.findMany({
    where: { isActive: true },
    select: {
      id: true,
      nameEn: true,
      nameMs: true,
      defaultDurationMinutes: true,
      requiresIdSighted: true,
    },
    orderBy: { nameEn: 'asc' },
  });
}
