import { describe, expect, it } from 'vitest';
import { Role } from '@prisma/client';
import { OVERSIGHT_ROLES, ROLE_HOME, canAdminister, homeForRole } from '@/lib/auth/authorize';

/**
 * The role matrix, asserted rather than assumed.
 *
 * The principal exists to read the system and change nothing. That promise is
 * only worth anything if it is enforced by the server, so these tests pin the
 * shape of the rules the guards are built from - and, in particular, that
 * "may view the admin area" and "may change things" are two different questions
 * with two different answers.
 */

describe('role coverage', () => {
  it('every role has a home to land on after signing in', () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_HOME[role], `${role} has no home`).toBeTruthy();
      expect(homeForRole(role).startsWith('/')).toBe(true);
    }
  });

  it('names exactly the four roles the school uses', () => {
    expect(Object.values(Role).sort()).toEqual(['ADMIN', 'GUARD', 'PRINCIPAL', 'TEACHER']);
  });
});

describe('who may administer', () => {
  it('only the administrator may change things', () => {
    expect(canAdminister(Role.ADMIN)).toBe(true);
    expect(canAdminister(Role.PRINCIPAL)).toBe(false);
    expect(canAdminister(Role.GUARD)).toBe(false);
    expect(canAdminister(Role.TEACHER)).toBe(false);
  });

  it('the principal is oversight, not authority', () => {
    // Reading the administrative screens and being able to act on them are
    // deliberately separate permissions; the principal has the first only.
    expect(OVERSIGHT_ROLES).toContain(Role.PRINCIPAL);
    expect(canAdminister(Role.PRINCIPAL)).toBe(false);
  });

  it('keeps guards and teachers out of the administrative area entirely', () => {
    expect(OVERSIGHT_ROLES).not.toContain(Role.GUARD);
    expect(OVERSIGHT_ROLES).not.toContain(Role.TEACHER);
  });

  it('sends the principal to the administrative screens, and the teacher to their own', () => {
    expect(homeForRole(Role.PRINCIPAL)).toBe('/admin');
    expect(homeForRole(Role.TEACHER)).toBe('/teacher');
    expect(homeForRole(Role.GUARD)).toBe('/guard');
  });
});
