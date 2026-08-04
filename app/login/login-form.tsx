'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { loginAction } from './actions';
import { Button } from '@/components/ui/button';
import { Field, Input, fieldAria } from '@/components/ui/field';
import { Alert } from '@/components/ui/surface';
import type { ActionResult } from '@/lib/result';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? 'Signing in...' : 'Sign in'}
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    loginAction,
    null,
  );

  const error = state && !state.ok ? state.message : null;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Field id="email" label="Email address" required>
        <Input
          {...fieldAria('email', {})}
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          hasError={Boolean(error)}
        />
      </Field>

      <Field id="password" label="Password" required>
        <Input
          {...fieldAria('password', {})}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          hasError={Boolean(error)}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
