import { test } from '@playwright/test';

/**
 * Step instrumentation for the end-to-end suite.
 *
 * The problem this solves: these journeys are long, and a bare
 * `expect(locator).toBeVisible() failed` gives no clue *where* in a
 * twenty-action flow it went wrong. Wrapping each meaningful action in
 * `test.step` makes Playwright attribute the failure to a named step, so the
 * error output and the trace viewer both say "Guard checks the visitor in"
 * rather than pointing at a line number.
 *
 * `E2E_VERBOSE=1` additionally streams progress to stdout, which is what you
 * want with `--reporter=line` when a test hangs rather than fails: the last
 * line printed is the step that stalled.
 *
 *   E2E_VERBOSE=1 npx playwright test tests/e2e/auth.spec.ts --project=desktop
 */

const VERBOSE = process.env.E2E_VERBOSE === '1';

function trace(symbol: string, message: string): void {
  if (!VERBOSE) return;
  // Written directly to stdout so it interleaves correctly with the reporter.
  process.stdout.write(`    ${symbol} ${message}\n`);
}

/**
 * Run `body` as a named Playwright step.
 *
 * A failure is logged with its step name and rethrown unchanged - the wrapper
 * annotates, it never swallows. The original error and stack reach the
 * reporter exactly as they would have without it.
 */
/**
 * Record that a phase of a long journey has been reached.
 *
 * Used to mark the acts of a multi-stage test where wrapping the whole section
 * in a closure would obscure the flow. The mark appears in the report timeline,
 * so when an assertion fails you can see which phase was last entered - the
 * failing assertion is somewhere after the final mark.
 */
export async function mark(phase: string): Promise<void> {
  await test.step(`--- ${phase} ---`, async () => {
    trace('##', phase);
  });
}

export async function step<T>(name: string, body: () => Promise<T>): Promise<T> {
  return test.step(name, async () => {
    const startedAt = Date.now();
    trace('->', name);

    try {
      const result = await body();
      trace('ok', `${name} (${Date.now() - startedAt}ms)`);
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
      trace('XX', `${name} FAILED after ${Date.now() - startedAt}ms: ${detail}`);
      throw error;
    }
  });
}
