import type { IdentityType, Visitor } from '@prisma/client';
import { maskIdentity } from '@/lib/crypto/identity';
import { maskEmail, maskPhone } from '@/lib/domain/contact';

/**
 * Safe view models.
 *
 * Every screen that shows a visitor renders one of these instead of the raw
 * row. The masking therefore happens once, at the boundary, rather than being
 * re-applied correctly at a dozen call sites - and a new page cannot
 * accidentally render `visitor.identityCiphertext` because the view model does
 * not carry it.
 *
 * The only route to a full identity value is the explicit, audited admin
 * reveal in `lib/domain/identity-reveal.ts`.
 */

export interface SafeVisitor {
  id: string;
  fullName: string;
  identityType: IdentityType;
  /** e.g. `******-**-5523` */
  identityMasked: string;
  emailMasked: string;
  phoneMasked: string;
  /**
   * Whether a contactable email exists, without disclosing the address.
   * Lets a screen warn that a reissued pass cannot be delivered.
   */
  hasEmail: boolean;
  /** Present only where an operational need exists (host arrival contact). */
  category: string;
}

type VisitorLike = Pick<
  Visitor,
  'id' | 'fullName' | 'identityType' | 'identityLast4' | 'email' | 'phone' | 'visitorCategory'
>;

export function toSafeVisitor(visitor: VisitorLike): SafeVisitor {
  return {
    id: visitor.id,
    fullName: visitor.fullName,
    identityType: visitor.identityType,
    identityMasked: maskIdentity(visitor.identityType, visitor.identityLast4),
    emailMasked: maskEmail(visitor.email),
    phoneMasked: maskPhone(visitor.phone),
    hasEmail: Boolean(visitor.email),
    category: visitor.visitorCategory,
  };
}

/** The Prisma `select` that produces exactly the fields `toSafeVisitor` needs. */
export const SAFE_VISITOR_SELECT = {
  id: true,
  fullName: true,
  identityType: true,
  identityLast4: true,
  email: true,
  phone: true,
  visitorCategory: true,
} as const;

const CATEGORY_LABELS: Record<string, string> = {
  PARENT: 'Parent',
  GUARDIAN: 'Guardian',
  CONTRACTOR: 'Contractor',
  OFFICIAL: 'Official',
  VENDOR: 'Vendor',
  ALUMNI: 'Alumni',
  OTHER: 'Other',
};

export function visitorCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? 'Other';
}

const IDENTITY_TYPE_LABELS: Record<string, string> = {
  NRIC: 'MyKad',
  PASSPORT: 'Passport',
  DRIVING_LICENCE: 'Driving licence',
  OTHER: 'Other ID',
};

export function identityTypeLabel(type: string): string {
  return IDENTITY_TYPE_LABELS[type] ?? 'ID';
}

/**
 * A visit is overdue when it is still checked in and the expected end plus the
 * configured grace period has passed. Overdue is always derived, never stored,
 * so it cannot drift out of date while a row sits untouched.
 */
export function isOverdue(
  visit: { status: string; expectedEnd: Date; checkedOutAt: Date | null },
  graceMinutes: number,
  now: Date = new Date(),
): boolean {
  if (visit.status !== 'CHECKED_IN' || visit.checkedOutAt) return false;
  return now.getTime() > visit.expectedEnd.getTime() + graceMinutes * 60_000;
}

/** Where a visitor was last confirmed by a named member of staff. */
export interface LastSeen {
  at: Date;
  destinationName: string | null;
  confirmedBy: string;
  method: string;
  kind: string;
}

/**
 * A visitor came through the gate but has never been confirmed anywhere since.
 *
 * This is the one movement signal worth alarming on. It does not ask where a
 * visitor is now - it asks whether anybody has seen them at all - so it stays
 * silent for the ordinary case of a visitor who met their host and then went
 * to the canteen, and speaks up for the case nobody can account for.
 *
 * Derived, never stored, for the same reason `isOverdue` is: a flag written
 * into a row goes stale the moment the row stops being touched.
 */
export function isAwaitingArrival(
  visit: { status: string; checkedInAt: Date | null; checkedOutAt: Date | null },
  lastSeen: LastSeen | null | undefined,
  graceMinutes: number,
  now: Date = new Date(),
): boolean {
  if (visit.status !== 'CHECKED_IN' || visit.checkedOutAt) return false;
  if (!visit.checkedInAt) return false;
  if (lastSeen) return false;
  return now.getTime() > visit.checkedInAt.getTime() + graceMinutes * 60_000;
}

export type AttentionFlag = 'AWAITING_ARRIVAL' | 'OVERDUE';

/**
 * Every reason this visit needs a guard's attention, most urgent first.
 *
 * An unaccounted-for arrival outranks someone merely staying late: the first
 * is a person nobody can place, the second is a person whose location is known
 * and whose clock has run out.
 */
export function attentionFlags(
  visit: {
    status: string;
    expectedEnd: Date;
    checkedInAt: Date | null;
    checkedOutAt: Date | null;
  },
  options: {
    lastSeen?: LastSeen | null;
    overdueGraceMinutes: number;
    arrivalGraceMinutes: number;
    /** False keeps arrival alerts out of the UI while adoption is still low. */
    arrivalAlertsEnabled: boolean;
    now?: Date;
  },
): AttentionFlag[] {
  const now = options.now ?? new Date();
  const flags: AttentionFlag[] = [];

  if (
    options.arrivalAlertsEnabled &&
    isAwaitingArrival(visit, options.lastSeen, options.arrivalGraceMinutes, now)
  ) {
    flags.push('AWAITING_ARRIVAL');
  }

  if (isOverdue(visit, options.overdueGraceMinutes, now)) flags.push('OVERDUE');

  return flags;
}
