/**
 * Application logger.
 *
 * Two jobs, and the second matters more than the first in this codebase.
 *
 * 1. **Noise control.** `debug` and `info` are development-only. They vanish in
 *    production and in tests, so a developer can leave useful tracing in place
 *    without it becoming log spam or a performance cost later. `warn` and
 *    `error` always emit: a failure that only surfaces on a developer's laptop
 *    is not a failure anyone will ever fix.
 *
 * 2. **Leak prevention.** Every context object is redacted before it is
 *    printed. The specification forbids passwords, session tokens, QR tokens,
 *    full identity numbers and IC images from ever reaching a log, and the way
 *    that rule actually gets broken is a well-meaning
 *    `logger.debug('checking in', { visitor })` during a late-night debugging
 *    session. Redacting centrally means a careless call site cannot leak,
 *    rather than relying on everyone remembering.
 *
 * Usage:
 *
 *   const log = createLogger('gate');
 *   log.debug('pass lookup', { visitId });        // development only
 *   log.error('check-in failed', { visitId }, error);
 */

import { sanitizeMetadata } from '@/lib/redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Extra structured context. Redacted before it is printed. */
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext, error?: unknown): void;
  /** Derive a narrower scope, e.g. `createLogger('gate').child('checkin')`. */
  child(scope: string): Logger;
}

/**
 * Read `NODE_ENV` directly rather than through `getEnv()`.
 *
 * The logger has to work in places where configuration is missing or invalid -
 * including the code path that reports *why* it is invalid - so it must never
 * depend on validation having succeeded.
 */
function isVerbose(): boolean {
  return process.env.NODE_ENV === 'development';
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function shouldEmit(level: LogLevel): boolean {
  // Errors and warnings always surface; tracing is development-only.
  if (LEVEL_ORDER[level] >= LEVEL_ORDER.warn) return true;
  return isVerbose();
}

/**
 * Reduce an unknown thrown value to something safe and useful.
 *
 * Stack traces are kept in development only: they can contain absolute file
 * paths and, in a database error, fragments of the offending query.
 */
export function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message.slice(0, 300),
      ...(isVerbose() && error.stack ? { stack: error.stack.split('\n').slice(0, 5).join('\n') } : {}),
    };
  }

  if (typeof error === 'string') return { errorMessage: error.slice(0, 300) };
  return { errorMessage: 'Unknown error' };
}

function write(level: LogLevel, scope: string, message: string, context?: LogContext): void {
  if (!shouldEmit(level)) return;

  const prefix = `[${scope}]`;
  // `sanitizeMetadata` is the same redaction the audit trail uses, so the two
  // cannot drift apart: anything unsafe to persist is unsafe to print.
  const safeContext = context ? sanitizeMetadata(context) : undefined;

  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (safeContext && Object.keys(safeContext).length > 0) {
    sink(prefix, message, safeContext);
  } else {
    sink(prefix, message);
  }
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, context) => write('debug', scope, message, context),
    info: (message, context) => write('info', scope, message, context),
    warn: (message, context) => write('warn', scope, message, context),
    error: (message, context, error) =>
      write('error', scope, message, {
        ...(context ?? {}),
        ...(error === undefined ? {} : describeError(error)),
      }),
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}

/** Default logger for code with no more specific scope. */
export const logger = createLogger('app');
