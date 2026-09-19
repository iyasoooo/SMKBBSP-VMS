import { expect, test } from '@playwright/test';
import { login, logout, selectHostTeacher, submitVisitRequest, uniqueNric } from './helpers';

/** AT-014 / AT-015: the two walk-in branches. */
test.describe('walk-in registration', () => {
  test('AT-014 a clear walk-in is registered and checked in', async ({ page }) => {
    const visitorName = `Walkin Clear ${Date.now().toString().slice(-6)}`;

    await login(page, 'guard');
    await page.goto('/guard/walk-in');

    await page.getByLabel('Full name').fill(visitorName);
    await page.getByLabel('Phone number').fill('013-222 3333');
    await page.getByLabel('Identification number').fill(uniqueNric());
    await selectHostTeacher(page);
    await page.getByLabel('Purpose').fill('Air-conditioning maintenance visit');
    await page.getByLabel(/I have seen the visitor/).check();

    await page.getByRole('button', { name: 'Register and check in' }).click();

    // Straight to the badge, which is the guard's next physical action.
    await expect(page).toHaveURL(/\/guard\/badge\//);
    await expect(page.getByText('VISITOR', { exact: true })).toBeVisible();
    await expect(page.getByText(visitorName).first()).toBeVisible();

    await page.goto('/guard/active');
    await expect(page.getByRole('cell', { name: visitorName })).toBeVisible();
  });

  test('AT-015 a blacklisted walk-in is refused with a neutral message', async ({ page }) => {
    // The seed creates this person as a hard BLOCK entry.
    await login(page, 'guard');
    await page.goto('/guard/walk-in');

    await page.getByLabel('Full name').fill('Rizal bin Sulaiman');
    await page.getByLabel('Phone number').fill('+60121119999');
    await page.getByLabel('Identification number').fill('779912319001');
    await selectHostTeacher(page);
    await page.getByLabel('Purpose').fill('Attempting entry for the blocked-path test');
    await page.getByLabel(/I have seen the visitor/).check();

    await page.getByRole('button', { name: 'Register and check in' }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: /contact an administrator/i }),
    ).toBeVisible();

    // The guard is told nothing about why.
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain('blacklist');
    expect(body).not.toContain('demonstration entry');
    expect(body).not.toContain('security incident');

    // No visit was created.
    await page.goto('/guard/active');
    await expect(page.getByRole('cell', { name: 'Rizal bin Sulaiman' })).toBeHidden();
  });
});

/** AT-007: rejection produces no usable pass. */
test('AT-007 a rejected request tells the visitor and issues no pass', async ({ page }) => {
  const visitorName = `Reject Path ${Date.now().toString().slice(-6)}`;
  const submitted = await submitVisitRequest(page, { visitorName });

  await login(page, 'teacher');
  await page.goto('/teacher/requests?filter=pending');

  await page
    .getByRole('row')
    .filter({ hasText: visitorName })
    .getByRole('link', { name: /Decide/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Reject' }).click();
  await page.getByLabel('Reason for rejection').fill('That week is reserved for examinations.');
  await page.getByRole('button', { name: 'Confirm rejection' }).click();

  // The page revalidates into its decided state, showing the reason the
  // visitor will read on their private page.
  await expect(page.getByRole('heading', { name: 'Decision' })).toBeVisible();
  await expect(page.getByText('That week is reserved for examinations.')).toBeVisible();
  // No gate status card exists, because rejection creates no visit.
  await expect(page.getByRole('heading', { name: 'Gate status' })).toBeHidden();

  // The request is now in the rejected list and out of the pending queue.
  await page.goto('/teacher/requests?filter=pending');
  await expect(page.getByRole('cell', { name: visitorName })).toBeHidden();

  await page.goto('/teacher/requests?filter=rejected');
  await expect(page.getByRole('cell', { name: visitorName }).first()).toBeVisible();
  await logout(page);

  // Nothing is sent to the visitor, so their saved link is how they learn of
  // it: the decision and reason are there, and no pass is.
  await page.goto(submitted.privatePath);
  await expect(page.getByText('Not approved', { exact: true })).toBeVisible();
  await expect(page.getByText('That week is reserved for examinations.')).toBeVisible();
  await expect(page.getByRole('img', { name: /QR visitor pass/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Save this page now' })).toBeHidden();
});

/** AT-019 / AT-021 / AT-024: admin filters, exports, and the audit trail. */
test('AT-021 admin exports both formats and the export is audited', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/admin/reports');

  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();

  const xlsx = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export Excel' }).click();
  const xlsxFile = await xlsx;
  expect(xlsxFile.suggestedFilename()).toMatch(/\.xlsx$/);

  const pdf = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export PDF' }).click();
  const pdfFile = await pdf;
  expect(pdfFile.suggestedFilename()).toMatch(/\.pdf$/);

  // AT-024: the export appears in the audit log.
  await page.goto('/admin/audit?action=report.exported');
  await expect(page.getByRole('cell', { name: 'report.exported' }).first()).toBeVisible();
});

test('AT-019 admin history masks every identity value', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/admin/visits');

  await expect(page.getByRole('heading', { name: 'Visit history' })).toBeVisible();

  const body = await page.locator('body').innerText();

  // Seeded NRICs all use the reserved 9912 middle segment; none may appear whole.
  expect(body).not.toMatch(/\b\d{12}\b/);
  expect(body).toMatch(/\*\*\*\*\*\*-\*\*-\d{4}/);
});

test('AT-022 blacklist reason is admin-only and never reaches a guard', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/admin/blacklist');

  // The admin can reach the restricted reason by expanding that entry's own
  // disclosure. Scoped to the row so the assertion cannot pass on a different
  // entry's already-open details.
  const blockedRow = page.getByRole('row').filter({ hasText: 'Rizal bin Sulaiman' }).first();
  await blockedRow.getByText('Internal reason').click();
  await expect(blockedRow.getByText(/Demonstration entry/)).toBeVisible();

  await logout(page);

  // A guard has no route to the blacklist at all.
  await login(page, 'guard');
  await page.goto('/admin/blacklist');
  await expect(page).toHaveURL(/\/guard/);
});

test('AT-020 dashboard recomputes when the range changes', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/admin');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // A range far in the past has no seeded data, so every derived figure must
  // fall to zero rather than showing a hard-coded number.
  await page.goto('/admin?from=2019-01-01&to=2019-01-31');

  await expect(page.getByText('No arrivals recorded in the selected range.')).toBeVisible();
  await expect(page.getByText('No data in the selected range.').first()).toBeVisible();

  // Approval rate and average duration have no denominator, so they render "-"
  // instead of inventing a value.
  const appointmentsTile = page
    .locator('div')
    .filter({ hasText: /^Appointments0$/ })
    .first();
  await expect(appointmentsTile).toBeVisible();
});
