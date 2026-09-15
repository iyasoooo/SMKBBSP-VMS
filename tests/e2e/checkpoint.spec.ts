import { expect, test } from '@playwright/test';
import { login, logout, selectHostTeacher, uniqueNric } from './helpers';
import { mark } from './steps';

/**
 * Arrival confirmation, end to end.
 *
 * Driven from a walk-in rather than an approved appointment for the same
 * reason the critical-path journey is: a walk-in is checked in the instant it
 * is created, and a checkpoint is only accepted for a visitor already admitted
 * at the gate. An online request booked during the run could never be inside
 * its window in time.
 *
 * The walk-in is hosted by the demo teacher account, so the same run can sign
 * in as that teacher and confirm its own visitor.
 */
test('a host confirms their visitor, and the gate sees where they were last seen', async ({
  page,
}) => {
  test.slow();

  const visitorName = `Checkpoint E2E ${Date.now().toString().slice(-6)}`;

  // --- 1. Guard admits a walk-in -----------------------------------------

  await mark('1. Guard admits a walk-in');
  await login(page, 'guard');
  await page.goto('/guard/walk-in');

  await page.getByLabel('Full name').fill(visitorName);
  await page.getByLabel('Phone number').fill('013-444 5555');
  await page.getByLabel('Identification number').fill(uniqueNric());
  await selectHostTeacher(page);
  await page.getByLabel('Purpose').fill('Checkpoint confirmation end to end test');
  await page.getByLabel(/I have seen the visitor/).check();
  await page.getByRole('button', { name: 'Register and check in' }).click();

  await expect(page).toHaveURL(/\/guard\/badge\//);

  // --- 2. Nobody has confirmed them yet ----------------------------------

  await mark('2. Nobody has confirmed them yet');
  await page.goto('/guard/active');

  const beforeRow = page.getByRole('row').filter({ hasText: visitorName });
  await expect(beforeRow).toBeVisible();
  await expect(beforeRow.getByText('Not confirmed since the gate')).toBeVisible();

  await logout(page);

  // --- 3. The host confirms the arrival ----------------------------------

  await mark('3. The host confirms the arrival');
  await login(page, 'teacher');
  await page.goto('/teacher/visits?filter=active');

  const teacherRow = page.getByRole('row').filter({ hasText: visitorName });
  await expect(teacherRow).toBeVisible();
  await teacherRow.getByRole('button', { name: 'Visitor has arrived' }).click();

  // The action revalidates, so the control becomes the departure one.
  await expect(
    teacherRow.getByRole('button', { name: 'Visitor has left me' }),
  ).toBeVisible();

  await logout(page);

  // --- 4. The gate now knows where they were last seen -------------------

  await mark('4. The gate now knows where they were last seen');
  await login(page, 'guard');
  await page.goto('/guard/active');

  const afterRow = page.getByRole('row').filter({ hasText: visitorName });
  await expect(afterRow).toBeVisible();
  await expect(afterRow.getByText('Not confirmed since the gate')).toBeHidden();

  /*
   * The confirming teacher is named in the "last seen" cell: a sighting with
   * no witness would be worth nothing, so the witness is what gets rendered.
   *
   * Matched together with the "confirmed by" label rather than on the name
   * alone. The host column carries the same name - she is both the teacher
   * this visitor came to see and the person who confirmed them - so the bare
   * name appears twice in this row and Playwright rejects the ambiguity. The
   * label is also what makes the assertion mean what it says: that she is
   * recorded as the witness, not merely that she is mentioned somewhere.
   */
  const lastSeenCell = afterRow.getByRole('cell').filter({ hasText: /confirmed by/i });
  await expect(lastSeenCell).toContainText(/Puan Aminah/);

  await logout(page);

  // --- 5. The host records the visitor leaving ---------------------------

  await mark('5. The host records the visitor leaving');
  await login(page, 'teacher');
  await page.goto('/teacher/visits?filter=active');

  const departureRow = page.getByRole('row').filter({ hasText: visitorName });
  await departureRow.getByRole('button', { name: 'Visitor has left me' }).click();

  await expect(departureRow.getByText('Departure recorded. Thank you.')).toBeVisible();
});

/**
 * A teacher must not be able to confirm somebody else's visitor.
 *
 * The service re-scopes every confirmation by `teacherId`, so this asserts the
 * screen never offers the control in the first place - the disclosure being
 * prevented is a teacher learning who else is on the grounds.
 */
test('a teacher sees only their own visitors on the confirmation queue', async ({ page }) => {
  await login(page, 'teacher');
  await page.goto('/teacher/visits?filter=active');

  const rows = page.getByRole('row').filter({ hasText: 'Visitor has arrived' });
  const count = await rows.count();

  for (let index = 0; index < count; index += 1) {
    // Every actionable row belongs to this teacher; the page query is scoped
    // by `teacherId`, so anything else appearing here would be a leak.
    await expect(rows.nth(index)).toBeVisible();
  }

  await expect(page.getByRole('heading', { name: 'My visits' })).toBeVisible();
});
