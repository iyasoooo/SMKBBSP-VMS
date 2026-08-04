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

    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, 'Enter your email address so we can send your pass.')
      .max(254, 'That email address is too long.')
      .pipe(z.email('Enter a valid email address.')),

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
