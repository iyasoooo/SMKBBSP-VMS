import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The suite runs against its own database (`visitorpass_e2e`) on its own port,
 * so a run never disturbs the demonstration data a developer is looking at.
 * That database is created, migrated and seeded by
 * `scripts/prepare-e2e-db.ts`, which `npm run test:e2e` runs first - Playwright
 * boots its `webServer` before `globalSetup`, so setup done there would be too
 * late for the app's first request.
 *
 * Workers are pinned to one: the tests share a single database and several of
 * them assert on the on-site list, which is global state by definition.
 */

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://visitorpass:visitorpass_local_dev@localhost:5432/visitorpass_e2e?schema=public';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // The guard scan page asks for the camera; granting it up front keeps the
    // permission prompt from blocking, while AT-013 explicitly tests denial.
    permissions: [],
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // A 10-inch Android tablet, the guard's actual device.
      name: 'guard-tablet',
      testMatch: /guard-.*\.spec\.ts/,
      use: { ...devices['Galaxy Tab S4 landscape'] },
    },
  ],

  webServer: {
    /*
     * A production build, not `next dev`.
     *
     * The dev server compiles each route on first request. Once the optional
     * OCR panel was added, that first compile pulled in a multi-megabyte WASM
     * module and pushed the initial navigation past the test's timeout, so the
     * suite failed on whichever test happened to hit a cold route first -
     * failures that had nothing to do with the behaviour under test.
     *
     * Building once up front removes that variable entirely and exercises the
     * same output a demonstration would run.
     */
    command: 'npm run build && npm run start -- --port 3100',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // Generous: this now includes a full production build.
    timeout: 300_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      APP_URL: BASE_URL,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
