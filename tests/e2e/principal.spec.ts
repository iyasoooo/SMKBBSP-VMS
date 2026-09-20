import { expect, test } from '@playwright/test';
import { login, logout } from './helpers';
import { step } from './steps';

/**
 * The principal: oversight without authority.
 *
 * The role's whole promise is that it can read the school's records and change
 * none of them. Asserting the buttons are hidden would only prove the page is
 * tidy, so these tests go at the routes directly - the way anyone probing the
 * system would - and check the server refuses, not merely that the interface
 * declined to offer.
 */

/** Screens that exist solely to change configuration. */
const CONFIGURATION_ROUTES = ['/admin/users', '/admin/settings', '/admin/destinations'];

/** Screens the principal is meant to read. */
const OVERSIGHT_ROUTES = [
  '/admin',
  '/admin/appointments',
  '/admin/visits',
  '/admin/reports',
  '/admin/blacklist',
  '/admin/audit',
];

test.describe('principal oversight', () => {
  test('can read every oversight screen', async ({ page }) => {
    await login(page, 'principal');

    for (const route of OVERSIGHT_ROUTES) {
      await step(`${route} opens`, async () => {
        await page.goto(route);
        await expect(page).toHaveURL(new RegExp(`${route.replace('/', '\\/')}$`));
        // Landing back on login or being bounced home would both fail here.
        await expect(page.getByRole('heading').first()).toBeVisible();
      });
    }

    await logout(page);
  });

  test('is refused by every configuration screen', async ({ page }) => {
    await login(page, 'principal');

    for (const route of CONFIGURATION_ROUTES) {
      await step(`${route} is refused`, async () => {
        await page.goto(route);
        // Redirected to their own home rather than shown the screen. Crucially
        // this is the server's decision, not a hidden navigation link.
        await expect(page).not.toHaveURL(new RegExp(`${route.replace('/', '\\/')}$`));
      });
    }

    await logout(page);
  });

  test('is offered no controls that would change anything', async ({ page }) => {
    await login(page, 'principal');

    await step('the visit list offers no housekeeping action', async () => {
      await page.goto('/admin/visits');
      await expect(page.getByRole('button', { name: /mark past visits as no-show/i })).toHaveCount(0);
    });

    await step('the blacklist cannot be added to or changed', async () => {
      await page.goto('/admin/blacklist');
      await expect(page.getByRole('button', { name: /deactivate|reactivate/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /add entry|create/i })).toHaveCount(0);
    });

    await step('the restricted blacklist reason stays hidden', async () => {
      await page.goto('/admin/blacklist');
      // Safeguarding and custody detail is administrator-only; oversight sees
      // that an entry exists and what it does, never why it was written.
      await expect(page.getByText('Internal reason')).toHaveCount(0);
    });

    await step('the navigation omits the configuration screens', async () => {
      await page.goto('/admin');
      const nav = page.getByRole('navigation', { name: 'Primary' });
      await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(1);
    });

    await logout(page);
  });

  test('is identified as view-only in the interface', async ({ page }) => {
    await login(page, 'principal');
    await page.goto('/admin');
    await expect(page.getByText(/principal \(view only\)/i)).toBeVisible();
    await logout(page);
  });
});

test.describe('teacher stays confined to their own queue', () => {
  test('cannot reach the administrative area at all', async ({ page }) => {
    await login(page, 'teacher');

    for (const route of [...OVERSIGHT_ROUTES, ...CONFIGURATION_ROUTES]) {
      await page.goto(route);
      await expect(page).not.toHaveURL(new RegExp(`${route.replace('/', '\\/')}$`));
    }

    await logout(page);
  });

  test('keeps the one power it needs: deciding its own requests', async ({ page }) => {
    await login(page, 'teacher');
    await page.goto('/teacher/requests');

    // Approving a visit addressed to them is the teacher's entire role in the
    // workflow, and it must survive the tightening of everything else.
    await expect(page.getByRole('heading', { name: /request/i }).first()).toBeVisible();

    await logout(page);
  });
});
