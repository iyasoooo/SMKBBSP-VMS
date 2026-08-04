import { expect, type Page } from '@playwright/test';
import { step } from './steps';

/** Demo credentials created by the seed. Development-only values. */
export const ACCOUNTS = {
  admin: { email: 'admin@smkbbsp.test', password: 'Admin#Demo2025' },
  guard: { email: 'guard@smkbbsp.test', password: 'Guard#Demo2025' },
  teacher: { email: 'teacher@smkbbsp.test', password: 'Teacher#Demo2025' },
} as const;

export async function login(page: Page, account: keyof typeof ACCOUNTS): Promise<void> {
  const { email, password } = ACCOUNTS[account];

  // The account name is safe to log; the password never is.
  await step(`Sign in as ${account}`, async () => {
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
  });
}

export async function logout(page: Page): Promise<void> {
  await step('Sign out', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login', { timeout: 20_000 });
  });
}

/**
 * The exact <option> label for the demo teacher account, as rendered by both
 * the public request form and the walk-in form (`name - department`).
 * This teacher is `teacher@smkbbsp.test`, so tests can approve their own
 * submissions after logging in.
 */
export const HOST_TEACHER_OPTION = 'Puan Aminah binti Zulkifli - Bahasa Melayu';

/** A weekday, inside school hours, comfortably in the future (Malaysian time). */
export function futureSchoolSlot(daysAhead = 3): { date: string; time: string } {
  const target = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);

  for (let i = 0; i < 7; i += 1) {
    const klWeekday = new Date(target.getTime() + 8 * 60 * 60 * 1000).getUTCDay();
    if (klWeekday !== 0 && klWeekday !== 6) break;
    target.setUTCDate(target.getUTCDate() + 1);
  }

  const kl = new Date(target.getTime() + 8 * 60 * 60 * 1000);
  const date = `${kl.getUTCFullYear()}-${String(kl.getUTCMonth() + 1).padStart(2, '0')}-${String(
    kl.getUTCDate(),
  ).padStart(2, '0')}`;

  return { date, time: '10:00' };
}

/** Unique-enough identity for a run, so repeated runs never collide. */
export function uniqueNric(): string {
  const tail = String(Date.now()).slice(-6);
  return `9901${tail.slice(0, 2)}99${tail.slice(2, 6)}`;
}

export interface SubmittedRequest {
  reference: string;
  visitorName: string;
  nric: string;
}

/**
 * Visit type used by the end-to-end journeys.
 *
 * Selected explicitly rather than relying on the form's default. The default is
 * simply the first option in an alphabetically ordered list, so renaming or
 * adding a visit type could silently switch it to one with
 * `requiresIdSighted: false` - and the gate journey asserts that check-in stays
 * disabled until the ID declaration is ticked, a control that only exists when
 * ID sighting is required. Pinning the type keeps that precondition true.
 */
export const ID_SIGHTED_VISIT_TYPE = 'Parent meeting';

/** Complete the public request form and return the reference shown. */
export async function submitVisitRequest(
  page: Page,
  options: { visitorName: string; nric?: string; purpose?: string } = {
    visitorName: 'E2E Test Visitor',
  },
): Promise<SubmittedRequest> {
  const nric = options.nric ?? uniqueNric();
  const slot = futureSchoolSlot();

  await step('Open the public request form', async () => {
    await page.goto('/visit/request');
  });

  await step('Fill the visitor details', async () => {
    await page.getByLabel('Full name').fill(options.visitorName);
    await page.getByLabel('Email address').fill('e2e.visitor@contoh.test');
    await page.getByLabel('Phone number').fill('012-345 6789');
    await page.getByLabel('Identification number').fill(nric);
  });

  await step('Choose the host teacher and visit type', async () => {
    await page.getByLabel('Teacher you wish to meet').selectOption({ label: HOST_TEACHER_OPTION });

    // The option text carries the duration too ("Parent meeting (30 min)"), so
    // resolve the value by partial text rather than matching a full label.
    const visitTypeSelect = page.getByLabel('Type of visit');
    const visitTypeValue = await visitTypeSelect
      .locator('option')
      .filter({ hasText: ID_SIGHTED_VISIT_TYPE })
      .first()
      .getAttribute('value');
    expect(visitTypeValue).toBeTruthy();
    await visitTypeSelect.selectOption(visitTypeValue ?? '');
  });

  await step(`Choose the slot ${slot.date} ${slot.time} and give a reason`, async () => {
    await page.getByLabel('Date of visit').fill(slot.date);
    await page.getByLabel('Arrival time').fill(slot.time);
    await page
      .getByLabel('Reason for your visit')
      .fill(options.purpose ?? 'End to end test of the appointment workflow');
  });

  await step('Accept the privacy notice and submit', async () => {
    await page.getByLabel(/I have read the notice above/).check();
    await page.getByRole('button', { name: 'Submit request' }).click();
    await page.waitForURL('**/visit/request/success**', { timeout: 20_000 });
  });

  return step('Read the reference from the confirmation page', async () => {
    const reference = (
      await page.locator('p.font-mono').filter({ hasText: /^VP-/ }).first().textContent()
    )?.trim();

    expect(reference).toBeTruthy();
    return { reference: reference ?? '', visitorName: options.visitorName, nric };
  });
}
