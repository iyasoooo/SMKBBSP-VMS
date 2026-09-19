import { z } from 'zod';
import { IdentityType, VisitorCategory } from '@prisma/client';
import { MAX_PARTY_SIZE } from '@/lib/constants';
import { normalizeIdentity, validateNormalizedIdentity } from '@/lib/crypto/identity';
import { isPlausiblePhone, normalizePhone } from '@/lib/domain/contact';

/**
 * Public appointment request validation.
 *
 * This runs on the server for every submission. Client-side HTML validation is
 * a convenience only; nothing here may be skipped because the browser already
 * checked it.
 *
 * Messages are written for a member of the public, not a developer, and never
 * echo back what the system knows about them.
 */

const identityTypeValues = [
  IdentityType.NRIC,
  IdentityType.PASSPORT,
  IdentityType.DRIVING_LICENCE,
  IdentityType.OTHER,
] as const;

const visitorCategoryValues = [
  VisitorCategory.PARENT,
  VisitorCategory.GUARDIAN,
  VisitorCategory.CONTRACTOR,
  VisitorCategory.OFFICIAL,
  VisitorCategory.VENDOR,
  VisitorCategory.ALUMNI,
  VisitorCategory.OTHER,
] as const;

export const appointmentRequestSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Enter your full name as it appears on your identification.')
      .max(120, 'That name is too long.'),

    /*
     * Optional. Nothing is ever sent to it - the system has no email - so it
     * is kept only for the school's records and for blacklist matching.
     * Blank means "not given", never an error.
     */
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, 'That email address is too long.')
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined))
      .refine((value) => value === undefined || z.email().safeParse(value).success, {
        message: 'Enter a valid email address or leave it blank.',
      }),

    phone: z
      .string()
      .trim()
      .min(1, 'Enter a contact phone number.')
      .max(30, 'That phone number is too long.')
      .refine((value) => isPlausiblePhone(normalizePhone(value)), {
        message: 'Enter a valid phone number, for example 012-345 6789.',
      }),

    identityType: z.enum(identityTypeValues, {
      message: 'Choose the type of identification you will bring.',
    }),

    identityNumber: z
      .string()
      .trim()
      .min(1, 'Enter your identification number.')
      .max(30, 'That identification number is too long.'),

    visitorCategory: z.enum(visitorCategoryValues, {
      message: 'Choose the option that best describes you.',
    }),

    teacherId: z.string().trim().min(1, 'Choose the teacher you wish to meet.'),
    visitTypeId: z.string().trim().min(1, 'Choose the type of visit.'),
    destinationId: z.string().trim().optional(),

    visitDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date of your visit.'),

    visitTime: z
      .string()
      .trim()
      .regex(/^\d{2}:\d{2}$/, 'Choose the time of your visit.'),

    purpose: z
      .string()
      .trim()
      .min(10, 'Briefly describe the reason for your visit (at least 10 characters).')
      .max(500, 'Please shorten the reason for your visit.'),

    partySize: z.coerce
      .number()
      .int('Enter a whole number of people.')
      .min(1, 'At least one person must attend.')
      .max(MAX_PARTY_SIZE, `A maximum of ${MAX_PARTY_SIZE} people can be recorded per request.`),

    vehicleNumber: z
      .string()
      .trim()
      .max(15, 'That vehicle number is too long.')
      .optional()
      .transform((value) => (value && value.length > 0 ? value.toUpperCase() : undefined)),

    consent: z
      .string()
      .optional()
      .refine((value) => value === 'on' || value === 'true', {
        message: 'You must agree to the privacy notice before submitting.',
      }),

    /**
     * Everyone attending besides the main visitor.
     *
     * The school needs to know who is on the grounds, not just how many, so a
     * party larger than one names each person. The count is cross-checked
     * against `partySize` below rather than trusted from either side alone.
     */
    companions: z
      .array(
        z.object({
          fullName: z
            .string()
            .trim()
            .min(2, 'Enter this person’s full name.')
            .max(120, 'That name is too long.'),
          relation: z
            .string()
            .trim()
            .min(2, 'Say how this person is related to you, for example Spouse or Son.')
            .max(40, 'Please shorten this.'),
          phone: z
            .string()
            .trim()
            .max(30, 'That phone number is too long.')
            .optional()
            .transform((value) => (value && value.length > 0 ? value : undefined))
            .refine((value) => value === undefined || isPlausiblePhone(normalizePhone(value)), {
              message: 'Enter a valid phone number or leave it blank.',
            }),
          identityType: z.enum(identityTypeValues).default(IdentityType.NRIC),
          identityNumber: z
            .string()
            .trim()
            .min(1, 'Enter this person’s identification number.')
            .max(30, 'That identification number is too long.'),
        }),
      )
      .max(MAX_PARTY_SIZE - 1)
      .default([]),
  })
  // Identity validity depends on the chosen type, so it is checked after the
  // individual fields have parsed.
  .superRefine((data, ctx) => {
    const normalized = normalizeIdentity(data.identityType, data.identityNumber);
    const result = validateNormalizedIdentity(data.identityType, normalized);

    if (!result.ok) {
      const message =
        result.code === 'NRIC_LENGTH' || result.code === 'NRIC_DIGITS'
          ? 'Enter a 12-digit Malaysian identity card number, for example 880101-14-5523.'
          : result.code === 'TOO_SHORT'
            ? 'That identification number looks too short.'
            : result.code === 'TOO_LONG'
              ? 'That identification number looks too long.'
              : 'Enter a valid identification number.';

      ctx.addIssue({ code: 'custom', path: ['identityNumber'], message });
    }

    // The party size and the named companions must agree. Checking both
    // directions stops a mismatch being silently resolved in the visitor's
    // favour, in either direction.
    const expected = data.partySize - 1;
    if (data.companions.length !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['partySize'],
        message:
          expected === 0
            ? 'Remove the additional people, or increase the number attending.'
            : `Give details for all ${expected} other ${expected === 1 ? 'person' : 'people'} attending.`,
      });
    }

    data.companions.forEach((companion, index) => {
      const normalized = normalizeIdentity(companion.identityType, companion.identityNumber);
      const result = validateNormalizedIdentity(companion.identityType, normalized);
      if (!result.ok) {
        ctx.addIssue({
          code: 'custom',
          path: ['companions', index, 'identityNumber'],
          message:
            result.code === 'NRIC_LENGTH' || result.code === 'NRIC_DIGITS'
              ? 'Enter a 12-digit identity card number, for example 880101-14-5523.'
              : 'Enter a valid identification number.',
        });
      }
    });

    // The same person cannot be counted twice, and cannot be their own
    // companion. Compared on the normalized value so formatting differences
    // do not defeat the check.
    const seen = new Map<string, number>();
    seen.set(normalizeIdentity(data.identityType, data.identityNumber), -1);
    data.companions.forEach((companion, index) => {
      const key = normalizeIdentity(companion.identityType, companion.identityNumber);
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['companions', index, 'identityNumber'],
          message:
            seen.get(key) === -1
              ? 'This is your own identification number.'
              : 'This person has already been added.',
        });
      } else {
        seen.set(key, index);
      }
    });
  });

export type AppointmentRequestInput = z.infer<typeof appointmentRequestSchema>;

/** Guard-entered walk-in. Email is optional; the visitor is standing there. */
export const walkInSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the visitor name.').max(120),

  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined))
    .refine((value) => value === undefined || z.email().safeParse(value).success, {
      message: 'Enter a valid email address or leave it blank.',
    }),

  phone: z
    .string()
    .trim()
    .min(1, 'Enter a contact phone number.')
    .max(30)
    .refine((value) => isPlausiblePhone(normalizePhone(value)), {
      message: 'Enter a valid phone number.',
    }),

  identityType: z.enum(identityTypeValues),
  identityNumber: z.string().trim().min(1, 'Enter the identification number.').max(30),
  visitorCategory: z.enum(visitorCategoryValues),

  teacherId: z.string().trim().min(1, 'Choose the host teacher.'),
  visitTypeId: z.string().trim().min(1, 'Choose the visit type.'),
  destinationId: z.string().trim().optional(),

  purpose: z.string().trim().min(3, 'Enter the purpose of the visit.').max(500),
  partySize: z.coerce.number().int().min(1).max(MAX_PARTY_SIZE),
  expectedDurationMinutes: z.coerce
    .number()
    .int()
    .min(5, 'Expected duration must be at least 5 minutes.')
    .max(600, 'Expected duration cannot exceed 10 hours.'),
  vehicleNumber: z
    .string()
    .trim()
    .max(15)
    .optional()
    .transform((value) => (value && value.length > 0 ? value.toUpperCase() : undefined)),

  idSighted: z
    .string()
    .optional()
    .transform((value) => value === 'on' || value === 'true'),
});

export type WalkInInput = z.infer<typeof walkInSchema>;

/** Teacher decision on a pending request. */
export const decisionSchema = z
  .object({
    appointmentId: z.string().trim().min(1),
    decision: z.enum(['APPROVE', 'REJECT']),
    note: z
      .string()
      .trim()
      .max(500, 'Please shorten your note.')
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
  })
  .superRefine((data, ctx) => {
    // A rejection the visitor cannot understand is worse than none at all.
    if (data.decision === 'REJECT' && (!data.note || data.note.length < 5)) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Give a short reason the visitor can understand.',
      });
    }
  });

export type DecisionInput = z.infer<typeof decisionSchema>;
