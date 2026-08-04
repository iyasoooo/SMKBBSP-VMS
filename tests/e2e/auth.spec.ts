import { expect, test } from '@playwright/test';
import { ACCOUNTS, login, logout } from './helpers';

/** AT-001 and AT-002: role landing and cross-role denial. */

test.describe('AT-001 staff login and role landing', () => {
  test('each role lands on its own home', async ({ page }) => {
    await login(page, 'admin');
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await logout(page);

    await login(page, 'guard');
    await expect(page).toHaveURL(/\/guard$/);
    await logout(page);

    await login(page, 'teacher');
    await expect(page).toHaveURL(/\/teacher$/);
    await logout(page);
  });

  test('invalid credentials show a generic error and create no session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email address').fill(ACCOUNTS.admin.email);
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Next.js injects its own role="alert" route announcer, so the form's
    // alert is selected by its text rather than by role alone.
    await expect(
      page.getByRole('alert').filter({ hasText: 'Incorrect email or password' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // Still unauthenticated: a protected page bounces back to login.
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });

  test('an unknown account gives the same message as a wrong password', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email address').fill('nobody@smkbbsp.test');
    await page.getByLabel('Password').fill('whatever-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Identical wording is what prevents account enumeration.
    // Next.js injects its own role="alert" route announcer, so the form's
    // alert is selected by its text rather than by role alone.
    await expect(
      page.getByRole('alert').filter({ hasText: 'Incorrect email or password' }),
    ).toBeVisible();
  });
});

test.describe('AT-002 cross-role access is denied', () => {
  test('a teacher cannot reach guard or admin areas', async ({ page }) => {
    await login(page, 'teacher');

    for (const path of ['/guard', '/guard/emergency', '/admin', '/admin/users']) {
      await page.goto(path);
      // Redirected to their own home; protected content never renders.
      await expect(page).toHaveURL(/\/teacher/);
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeHidden();
    }
  });

  test('a guard cannot reach admin areas or download an export', async ({ page }) => {
    await login(page, 'guard');

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/guard/);

    const response = await page.request.get('/admin/reports/export?format=xlsx');
    expect(response.status()).toBe(404);
  });

  test('an unauthenticated visitor cannot reach any staff page', async ({ page }) => {
    for (const path of ['/admin', '/guard', '/teacher', '/teacher/requests']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });
});
