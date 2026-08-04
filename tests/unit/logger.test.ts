import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger, describeError } from '@/lib/logger';

/**
 * The logger's real job is leak prevention, so most of these tests are about
 * what must *not* appear in output. `tests/setup.ts` pins NODE_ENV to 'test',
 * which is deliberately not 'development' - so the default state here is the
 * quiet one, and verbose behaviour is opted into per test.
 */

const spies = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
};

function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>)['NODE_ENV'] = value;
}

const originalEnv = process.env.NODE_ENV;

beforeEach(() => {
  spies.log.mockClear();
  spies.warn.mockClear();
  spies.error.mockClear();
});

afterEach(() => {
  setNodeEnv(originalEnv ?? 'test');
});

describe('level gating', () => {
  it('suppresses debug and info outside development', () => {
    setNodeEnv('production');
    const log = createLogger('test');

    log.debug('a debug line');
    log.info('an info line');

    expect(spies.log).not.toHaveBeenCalled();
  });

  it('emits debug and info in development', () => {
    setNodeEnv('development');
    const log = createLogger('test');

    log.debug('a debug line');
    log.info('an info line');

    expect(spies.log).toHaveBeenCalledTimes(2);
  });

  it('always emits warnings and errors, even in production', () => {
    setNodeEnv('production');
    const log = createLogger('test');

    log.warn('a warning');
    log.error('a failure');

    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.error).toHaveBeenCalledTimes(1);
  });

  it('is quiet by default under the test environment', () => {
    const log = createLogger('test');
    log.debug('should not appear');
    expect(spies.log).not.toHaveBeenCalled();
  });
});

describe('scoping', () => {
  it('prefixes every line with its scope', () => {
    setNodeEnv('production');
    createLogger('gate').error('failed');
    expect(spies.error).toHaveBeenCalledWith('[gate]', 'failed');
  });

  it('nests child scopes', () => {
    setNodeEnv('production');
    createLogger('gate').child('checkin').error('failed');
    expect(spies.error).toHaveBeenCalledWith('[gate:checkin]', 'failed');
  });
});

describe('redaction', () => {
  it('redacts anything that looks like a secret', () => {
    setNodeEnv('production');
    createLogger('test').error('boom', {
      password: 'Correct#Horse2026',
      sessionToken: 'abc123',
      qrToken: 'zzz',
      identityNumber: '880101145523',
      visitId: 'visit_1',
    });

    const printed = JSON.stringify(spies.error.mock.calls[0]);
    expect(printed).not.toContain('Correct#Horse2026');
    expect(printed).not.toContain('abc123');
    expect(printed).not.toContain('880101145523');
    // Non-sensitive context still gets through, or the logger is useless.
    expect(printed).toContain('visit_1');
  });

  it('redacts nested structures too', () => {
    setNodeEnv('production');
    createLogger('test').error('boom', {
      visitor: { fullName: 'Nurul Huda', identityNumber: '880101145523' },
    });

    const printed = JSON.stringify(spies.error.mock.calls[0]);
    expect(printed).not.toContain('880101145523');
  });

  it('omits the context argument entirely when nothing survives redaction', () => {
    setNodeEnv('production');
    createLogger('test').error('boom', {});
    expect(spies.error).toHaveBeenCalledWith('[test]', 'boom');
  });
});

describe('error description', () => {
  it('captures the name and message but not the stack in production', () => {
    setNodeEnv('production');
    const described = describeError(new Error('database exploded'));

    expect(described.errorName).toBe('Error');
    expect(described.errorMessage).toBe('database exploded');
    expect(described.stack).toBeUndefined();
  });

  it('includes a truncated stack in development', () => {
    setNodeEnv('development');
    const described = describeError(new Error('database exploded'));
    expect(typeof described.stack).toBe('string');
  });

  it('handles non-Error throws without breaking', () => {
    expect(describeError('just a string').errorMessage).toBe('just a string');
    expect(describeError(undefined).errorMessage).toBe('Unknown error');
    expect(describeError({ weird: true }).errorMessage).toBe('Unknown error');
  });

  it('truncates an enormous message rather than printing all of it', () => {
    const described = describeError(new Error('x'.repeat(5000)));
    expect(String(described.errorMessage).length).toBeLessThanOrEqual(300);
  });

  it('attaches error detail when passed to logger.error', () => {
    setNodeEnv('production');
    createLogger('test').error('failed', { visitId: 'v1' }, new Error('nope'));

    const printed = JSON.stringify(spies.error.mock.calls[0]);
    expect(printed).toContain('nope');
    expect(printed).toContain('v1');
  });
});
