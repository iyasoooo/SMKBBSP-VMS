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
