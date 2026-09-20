import { expect, test } from '@playwright/test';
import { login, logout, selectHostTeacher, submitVisitRequest, uniqueNric } from './helpers';
import { mark } from './steps';


/**
 * The primary critical path from docs/spec/ACCEPTANCE_TESTS.md.
 *
 * Run as one test on purpose: each step depends on the state the previous one
 * produced, and splitting it would only make the failure harder to read.
 *
 * One structural note. The online booking rules require at least 60 minutes'
 * notice, and an approved pass only becomes valid 30 minutes before its start,
 * so a request submitted by this test can never be inside its gate window
 * while the test is still running. Rather than manipulate the clock or weaken
 * the rules, the test asserts the *correct refusal* for the not-yet-valid pass
 * (AT-011) and then drives the full gate lifecycle with a walk-in, which is by
 * definition checked in at the moment it is created.
 */
test('AT-003/006/010/016/017/018 full appointment to check-out journey', async ({ page }) => {
  test.slow();

  const visitorName = `E2E Journey ${Date.now().toString().slice(-6)}`;

  // --- 1. Visitor submits -------------------------------------------------

  await mark('1. Visitor submits');
  const submitted = await submitVisitRequest(page, { visitorName });
  expect(submitted.reference).toMatch(/^VP-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  // AT-003: with no email, the visitor lands on their private page and is
  // told plainly to save it. The token lives in the path, never a query string.
  await expect(page.getByText('Request submitted')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Save this page now' })).toBeVisible();
  await expect(page.getByText('Awaiting approval')).toBeVisible();
  expect([...new URL(page.url()).searchParams.keys()]).toEqual(['new']);

  // No pass is shown before a decision.
  await expect(page.getByRole('img', { name: /QR visitor pass/ })).toHaveCount(0);

  // --- 2. Teacher approves ------------------------------------------------

  await mark('2. Teacher approves');
  await login(page, 'teacher');
  await page.goto('/teacher/requests?filter=pending');

  await page
    .getByRole('row')
    .filter({ hasText: visitorName })
    .getByRole('link', { name: /Decide/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: visitorName })).toBeVisible();

  // The teacher sees a masked identity only.
  await expect(page.getByText(/\*\*\*\*\*\*-\*\*-\d{4}/)).toBeVisible();
  await expect(page.getByText(submitted.nric)).toBeHidden();

  await page.getByRole('button', { name: 'Approve this visit' }).click();
  await page.getByLabel(/Note for the visitor/).fill('Please wait at the general office.');
  await page.getByRole('button', { name: 'Confirm approval' }).click();

  // The action revalidates the page, so it re-renders in its decided state and
  // the decision form is replaced. Assert on that persisted result rather than
  // on the transient confirmation panel.
  await expect(page.getByRole('heading', { name: 'Decision' })).toBeVisible();
  await expect(page.getByText('Please wait at the general office.')).toBeVisible();
  await logout(page);

  // --- 2b. The link saved at submission now shows the pass ---------------

  // AT-006: nothing was sent to the visitor. The only thing they have is the
  // link from step 1, so reopen exactly that and expect the pass on it.
  await mark('2b. The saved link now shows the pass');
  await page.goto(submitted.privatePath);
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /QR visitor pass/ })).toBeVisible();
  await expect(page.getByText('Please wait at the general office.')).toBeVisible();

  // --- 3. The guard can find them, but the pass is not valid yet ----------

  await mark('3. The guard can find them, but the pass is not valid yet');
  await login(page, 'guard');
  await page.goto('/guard');

  await page.getByRole('searchbox').fill(visitorName);
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await page.getByRole('link', { name: new RegExp(visitorName) }).first().click();

  // Wait for the detail route itself before asserting on its controls. Without
  // this the heading check below can be satisfied while the search results are
  // still on screen, and the assertions that follow then run against a page
  // that has no gate actions on it at all.
  await page.waitForURL(/\/guard\/visits\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: visitorName })).toBeVisible();

  // Check-in stays disabled until the ID declaration is ticked. This only holds
  // because the request pinned a visit type that requires ID sighting; without
  // that the checkbox is not rendered and the button starts enabled.
  const checkInButton = page.getByRole('button', { name: 'Check in', exact: true });
  await expect(checkInButton).toBeVisible();
  await expect(checkInButton).toBeDisabled();

  await page.getByLabel(/I have seen the visitor/).check();
  await expect(checkInButton).toBeEnabled();
  await checkInButton.click();

  // AT-011: the visit starts days from now, so the credential window is shut
  // and the server refuses - the check the whole pass-expiry design exists for.
  await expect(
    page.getByRole('alert').filter({ hasText: /outside its valid time window/i }),
  ).toBeVisible();

  // --- 4. Gate lifecycle, driven by a walk-in that is valid right now ------

  await mark('4. Gate lifecycle, driven by a walk-in that is valid right now');
  const gateVisitor = `E2E Gate ${Date.now().toString().slice(-6)}`;

  await page.goto('/guard/walk-in');
  await page.getByLabel('Full name').fill(gateVisitor);
  await page.getByLabel('Phone number').fill('014-555 6666');
  await page.getByLabel('Identification number').fill(uniqueNric());
  await selectHostTeacher(page);
  await page.getByLabel('Purpose').fill('Gate lifecycle end to end check');
  await page.getByLabel(/I have seen the visitor/).check();
  await page.getByRole('button', { name: 'Register and check in' }).click();

  /*
   * --- 5. The pass is handed over on screen, and carries nothing sensitive --
   *
   * Walk-ins no longer print a badge and no longer redirect to one: the form
   * is replaced in place by the visitor's digital pass, which the guard turns
   * the tablet around to show. AT-017 still applies, only to a different
   * artefact - what the visitor is handed must not carry their identity
   * number, their phone number or why they came.
   */
  await mark('5. The pass is shown on screen and carries nothing sensitive');
  await expect(page).toHaveURL(/\/guard\/walk-in/);
  await expect(page.getByText('Registered and checked in.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Show this to the visitor' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Show this to the visitor' })).toBeVisible();

  // The badge number and the manual code are both offered, because the QR is
  // not the only way in - a camera that will not focus must not strand anyone.
  await expect(page.getByText(/^V-\d{6}-\d{4}$/)).toBeVisible();
  await expect(page.getByText('Pass code')).toBeVisible();

  // Kept for step 7, which leaves by the same pass the visitor arrived with.
  const passCode = await page.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/).innerText();

  const passText = (await page.locator('body').innerText()).toLowerCase();
  expect(passText).not.toContain('014-555');
  expect(passText).not.toContain('gate lifecycle end to end check');
  expect(passText).not.toMatch(/\b\d{12}\b/);

  // --- 6. Emergency list includes them ------------------------------------

  await mark('6. Emergency list includes them');
  await page.goto('/guard/emergency');
  await expect(page.getByRole('cell', { name: gateVisitor })).toBeVisible();

  // AT-018: sensitive fields are absent from the printed sheet.
  const emergencyText = (await page.locator('body').innerText()).toLowerCase();
  expect(emergencyText).not.toContain('014-555');
  expect(emergencyText).not.toMatch(/\b\d{12}\b/);

  // --- 7. Check out -------------------------------------------------------

  /*
   * Out by the same pass they came in with, which is the flow at going-home
   * time: scan, check out, next person. The scan is what identifies the visit,
   * so the action sits on the scan result rather than a page further in.
   *
   * Driven through the manual code because CI has no camera; the code and the
   * QR resolve to the same credential.
   */
  await mark('7. Check out from the scan result');
  await page.goto('/guard/scan');
  await page.getByLabel('Pass code').fill(passCode);
  await page.getByRole('button', { name: 'Look up' }).click();

  // Recognised as someone already inside rather than as an expired or unknown
  // pass - the distinction the whole check-out path rests on.
  await expect(page.getByText('Already checked in')).toBeVisible();

  await page.getByRole('button', { name: 'Check out', exact: true }).click();
  await expect(page.getByText('Visitor checked out.')).toBeVisible();

  // And it is persisted, not just acknowledged on screen.
  await page.goto('/guard/scan');
  await page.getByLabel('Pass code').fill(passCode);
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByText('Visit already completed')).toBeVisible();

  // --- 8. Emergency list excludes them ------------------------------------

  await mark('8. Emergency list excludes them');
  await page.goto('/guard/emergency');
  await expect(page.getByRole('cell', { name: gateVisitor })).toBeHidden();
});

test('AT-013 camera denial still leaves the manual code path usable', async ({ page, context }) => {
  // Explicitly refuse the camera, the situation this test exists for.
  await context.clearPermissions();

  await login(page, 'guard');
  await page.goto('/guard/scan');

  // The manual entry field is present without any interaction with the camera.
  const codeField = page.getByLabel('Pass code');
  await expect(codeField).toBeVisible();

  await codeField.fill('ZZZZZZZZ');
  await page.getByRole('button', { name: 'Look up' }).click();

  // An unknown code returns a safe state rather than an error page. The phrase
  // appears as both the result heading and its explanatory line.
  await expect(page.getByText('Pass not recognised').first()).toBeVisible();
  await expect(page.getByLabel('Pass code')).toBeVisible();
});

test('AT-026 Bahasa Melayu and dark mode persist across navigation', async ({ page }) => {
  await login(page, 'guard');
  await page.goto('/guard');

  await page.getByRole('button', { name: 'MS' }).click();
  await expect(page.getByRole('heading', { name: 'Hari ini di pintu pagar' })).toBeVisible();

  // Dark mode on.
  await page.getByRole('button', { name: /Switch to dark mode/ }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);

  // Both survive a full reload and a navigation.
  await page.goto('/guard/walk-in');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('heading', { name: 'Daftar pelawat tanpa temu janji' })).toBeVisible();

  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByText('Nama penuh')).toBeVisible();
});
