/**
 * Shared domain constants.
 *
 * Values that an administrator can change at runtime live in the `Setting`
 * table (see `lib/domain/settings.ts`). The values here are structural: they
 * define the shape of the product rather than a school's preference.
 */

/** Consent text version recorded against every visitor submission. */
export const CONSENT_VERSION = '2026-01';

/** Bytes of entropy for public/QR tokens. 32 bytes = 256 bits. */
export const TOKEN_BYTES = 32;

/**
 * Fallback code alphabet with I, L, O, U, 0 and 1 removed.
 * A guard reads these aloud from a badge under bad lighting; ambiguous glyphs
 * cause failed lookups and slow the gate down.
 */
export const FALLBACK_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const FALLBACK_CODE_LENGTH = 8;

/** Maximum people recorded against a single appointment. */
export const MAX_PARTY_SIZE = 20;

/** Pagination defaults for history and queue screens. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** How long a private visitor status link stays usable after the visit ends. */
export const PUBLIC_TOKEN_TRAILING_DAYS = 7;

/** Shown wherever a staff password is set; mirrors PASSWORD_MIN_LENGTH. */
export const PASSWORD_MIN_LENGTH_HINT = 'Use at least 10 characters.';

export const LOCALES = ['en', 'ms'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_COOKIE = 'vp_locale';
export const THEME_COOKIE = 'vp_theme';
export const SESSION_COOKIE = 'vp_session';

/**
 * Machine-readable denial codes. These are stored on the visit and shown to
 * guards through the localisation dictionary; the underlying reason (for
 * example which blacklist entry matched) is never exposed at the gate.
 */
export const DENIAL_CODES = {
  BLACKLIST_BLOCK: 'BLACKLIST_BLOCK',
  PASS_EXPIRED: 'PASS_EXPIRED',
  PASS_REVOKED: 'PASS_REVOKED',
  NOT_APPROVED: 'NOT_APPROVED',
  ID_NOT_SIGHTED: 'ID_NOT_SIGHTED',
  GUARD_DECISION: 'GUARD_DECISION',
} as const;

export type DenialCode = (typeof DENIAL_CODES)[keyof typeof DENIAL_CODES];

/** Audit action names. Kept as a closed set so the audit filter can enumerate them. */
export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILURE: 'auth.login.failure',
  LOGOUT: 'auth.logout',
  SESSION_REVOKED: 'auth.session.revoked',

  APPOINTMENT_CREATED: 'appointment.created',
  APPOINTMENT_APPROVED: 'appointment.approved',
  APPOINTMENT_REJECTED: 'appointment.rejected',
  APPOINTMENT_CANCELLED: 'appointment.cancelled',
  APPOINTMENT_REVIEW_RESOLVED: 'appointment.review.resolved',
  APPOINTMENT_EXPIRED: 'appointment.expired',

  VISIT_CHECKED_IN: 'visit.checked_in',
  VISIT_CHECKED_OUT: 'visit.checked_out',
  VISIT_DENIED: 'visit.denied',
  VISIT_NO_SHOW: 'visit.no_show',
  VISIT_BADGE_PRINTED: 'visit.badge_printed',
  VISIT_CHECKPOINT_RECORDED: 'visit.checkpoint_recorded',

  WALK_IN_CREATED: 'walk_in.created',
  WALK_IN_BLOCKED: 'walk_in.blocked',

  CREDENTIAL_REVOKED: 'credential.revoked',
  CREDENTIAL_REISSUED: 'credential.reissued',

  BLACKLIST_CREATED: 'blacklist.created',
  BLACKLIST_UPDATED: 'blacklist.updated',
  BLACKLIST_DEACTIVATED: 'blacklist.deactivated',
  BLACKLIST_REVIEWED: 'blacklist.reviewed',

  IDENTITY_REVEALED: 'identity.revealed',

  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DEACTIVATED: 'user.deactivated',
  USER_REACTIVATED: 'user.reactivated',
  USER_PASSWORD_RESET: 'user.password_reset',

  DESTINATION_CREATED: 'destination.created',
  DESTINATION_UPDATED: 'destination.updated',
  VISIT_TYPE_CREATED: 'visit_type.created',
  VISIT_TYPE_UPDATED: 'visit_type.updated',
  SETTING_UPDATED: 'setting.updated',

  REPORT_EXPORTED: 'report.exported',
  NOTIFICATION_RETRIED: 'notification.retried',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
