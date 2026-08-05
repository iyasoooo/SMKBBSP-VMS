import { expect, test, type Page } from '@playwright/test';
import { login, logout } from './helpers';
import { step } from './steps';

/**
 * Phone-width layout checks.
 *
 * Runs only in the `phone` project (360x780, a Galaxy S24 in portrait). An
 * iPhone 16 is 393px wide, so anything that passes here has room to spare on
 * iOS.
 *
 * These assert layout properties rather than behaviour - the workflows are
 * already covered at desktop and tablet widths, and re-running them here would
 * only re-prove logic that does not depend on screen size.
 *
 * The central assertion is that the page body never scrolls sideways. Sideways
 * scroll is the failure mode that makes a site feel broken on a phone, and it
 * is invisible at every other viewport, so nothing else in the suite would
 * catch it.
 */

/**
 * Wide content - tables, print layouts - is allowed to scroll inside its own
 * container. What must never happen is the *document* scrolling sideways.
 * A single pixel of tolerance absorbs sub-pixel rounding.
 */
async function expectNoSidewaysScroll(page: Page, label: string): Promise<void> {
  const overflowBy = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflowBy, `${label} scrolls sideways by ${overflowBy}px at 360px wide`).toBeLessThanOrEqual(1);
}

/**
 * Report every element that pushes past the viewport, not just the fact that
 * something did. A bare "the page is too wide" failure sends you hunting.
 */
async function reportOverflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const guilty: string[] = [];

    /**
     * True only when a *strict ancestor* scrolls horizontally.
     *
     * Deliberately not `closest()`, which matches the element itself: a
     * horizontal scroller that is itself wider than the viewport is exactly the
     * bug being hunted, and treating it as exempt hides it completely. Computed
     * style is used rather than the class name so a hand-rolled scroller counts
     * the same as one built with the utility.
     */
    const insideScroller = (el: HTMLElement): boolean => {
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll') return true;
        parent = parent.parentElement;
      }
      return false;
    };

    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= limit + 1) continue;
      if (insideScroller(el)) continue;

      const style = getComputedStyle(el);
      const scrolls = style.overflowX === 'auto' || style.overflowX === 'scroll';

      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' ? `.${el.className.split(/\s+/)[0]}` : '';
      // Reporting own width and content width separates the two failure modes:
      // an element that is too wide, versus one sized correctly whose content
      // simply cannot be reached because scrolling is not enabled.
      guilty.push(
        `${el.tagName.toLowerCase()}${id}${cls}` +
          ` right=${Math.round(rect.right)} w=${Math.round(rect.width)}` +
          ` content=${el.scrollWidth}${scrolls ? ' [scroller]' : ''}`,
      );
    }

    return [...new Set(guilty)].slice(0, 12);
  });
}

async function checkPage(page: Page, path: string, label: string): Promise<void> {
  await step(`${label} fits 360px`, async () => {
    await page.goto(path);
    const offenders = await reportOverflowingElements(page);
    // Report elements first: the message names the culprit, whereas a bare
    // sideways-scroll number only says the page is too wide somewhere.
    expect(offenders, `overflowing elements on ${label}: ${offenders.join(', ')}`).toEqual([]);
    await expectNoSidewaysScroll(page, label);
  });
}

test.describe('public pages fit a phone screen', () => {
  test('home, request form and status help', async ({ page }) => {
    await checkPage(page, '/', 'home');
    await checkPage(page, '/visit/request', 'request form');
    await checkPage(page, '/visit/status', 'status help');
    await checkPage(page, '/login', 'login');
  });

  test('the request form stacks into a single column', async ({ page }) => {
    await page.goto('/visit/request');

    // The two-column pairs collapse below the sm breakpoint, so the name and
    // email fields should sit on separate rows rather than side by side.
    const name = await page.getByLabel('Full name').boundingBox();
    const email = await page.getByLabel('Email address').boundingBox();

    expect(name).not.toBeNull();
    expect(email).not.toBeNull();
    expect(email!.y).toBeGreaterThan(name!.y + name!.height - 1);
  });
});

test.describe('staff pages fit a phone screen', () => {
  test('guard gate screens', async ({ page }) => {
    await login(page, 'guard');

    await checkPage(page, '/guard', 'guard home');
    await checkPage(page, '/guard/scan', 'scan');
    await checkPage(page, '/guard/walk-in', 'walk-in');
    await checkPage(page, '/guard/active', 'on-site list');
    await checkPage(page, '/guard/emergency', 'emergency list');

    await logout(page);
  });

  test('admin screens, including the wide tables', async ({ page }) => {
    await login(page, 'admin');

    await checkPage(page, '/admin', 'dashboard');
    await checkPage(page, '/admin/visits', 'visit history');
    await checkPage(page, '/admin/reports', 'reports');
    await checkPage(page, '/admin/users', 'users');
    await checkPage(page, '/admin/audit', 'audit log');

    await logout(page);
  });

  test('teacher screens', async ({ page }) => {
    await login(page, 'teacher');

    await checkPage(page, '/teacher', 'teacher home');
    await checkPage(page, '/teacher/requests', 'request queue');

    await logout(page);
  });
});

test.describe('touch targets stay usable', () => {
  test('guard controls meet the 44px minimum', async ({ page }) => {
    await login(page, 'guard');
    await page.goto('/guard');

    // The specification requires at least 44 CSS pixels on guard screens; a
    // gloved finger on a gate tablet cannot reliably hit anything smaller.
    const undersized = await page.evaluate(() => {
      const bad: string[] = [];
      const controls = document.querySelectorAll<HTMLElement>(
        'main a[href], main button, nav a[href]',
      );

      for (const el of Array.from(controls)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.height < 44) bad.push(`${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30)}" ${Math.round(rect.height)}px`);
      }
      return [...new Set(bad)].slice(0, 10);
    });

    expect(undersized, `controls below 44px: ${undersized.join(' | ')}`).toEqual([]);

    await logout(page);
  });
});
