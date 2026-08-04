/**
 * Shared result shape for server actions.
 *
 * Server actions return values instead of throwing so the UI can render
 * field-level errors without an error boundary. Anything thrown is treated as
 * an unexpected fault and rendered as a generic message, which keeps internal
 * details out of the browser.
 */

export interface ActionSuccess<T = undefined> {
  ok: true;
  data: T;
}

export interface ActionFailure {
  ok: false;
  /** Message safe to render directly to the current audience. */
  message: string;
  /** Field name -> message, for inline form errors. */
  fieldErrors?: Record<string, string>;
  /** Stable code the UI can branch on (e.g. to show a rate-limit countdown). */
  code?: string;
}

export type ActionResult<T = undefined> = ActionSuccess<T> | ActionFailure;

export function ok(): ActionResult<undefined>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail(
  message: string,
  options: { fieldErrors?: Record<string, string>; code?: string } = {},
): ActionFailure {
  return { ok: false, message, ...options };
}

/** Flatten a Zod error into the `fieldErrors` shape used by forms. */
export function toFieldErrors(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_form';
    // Keep the first message per field: showing three at once is noise.
    errors[key] ??= issue.message;
  }
  return errors;
}
