'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createUserAction } from '@/app/admin/actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, fieldAria } from '@/components/ui/field';
import { Alert } from '@/components/ui/surface';
import type { ActionResult } from '@/lib/result';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Creating...' : 'Create account'}
    </Button>
  );
}

export function CreateUserForm() {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    createUserAction,
    null,
  );
  const [role, setRole] = useState('TEACHER');

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4" noValidate>
      {state && !state.ok ? <Alert tone="danger">{state.message}</Alert> : null}
      {state?.ok ? (
        <Alert tone="success">
          Account created. Give the password to the user directly - it is not emailed.
        </Alert>
      ) : null}

      <Field id="u-name" label="Full name" required error={errors.name}>
        <Input
          {...fieldAria('u-name', { error: errors.name })}
          name="name"
          required
          maxLength={120}
          hasError={Boolean(errors.name)}
        />
      </Field>

      <Field id="u-email" label="Email address" required error={errors.email}>
        <Input
          {...fieldAria('u-email', { error: errors.email })}
          name="email"
          type="email"
          required
          autoCapitalize="none"
          spellCheck={false}
          hasError={Boolean(errors.email)}
        />
      </Field>

      <Field id="u-role" label="Role" required>
        <Select
          id="u-role"
          name="role"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          required
        >
          <option value="TEACHER">Staff (can host visitors)</option>
          <option value="GUARD">Security guard</option>
          <option value="ADMIN">Administrator</option>
          <option value="PRINCIPAL">Principal (view only)</option>
        </Select>
      </Field>

      {role === 'TEACHER' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="u-staffcode" label="Staff code" error={errors.staffCode}>
            <Input
              {...fieldAria('u-staffcode', { error: errors.staffCode })}
              name="staffCode"
              maxLength={40}
              placeholder="GKM-1007"
            />
          </Field>
          <Field id="u-department" label="Department" error={errors.department}>
            <Input
              {...fieldAria('u-department', { error: errors.department })}
              name="department"
              maxLength={80}
              placeholder="Matematik"
            />
          </Field>
        </div>
      ) : null}

      <Field
        id="u-password"
        label="Initial password"
        required
        error={errors.password}
        hint="At least 10 characters. Share it with the user directly and ask them to change it."
      >
        <Input
          {...fieldAria('u-password', { error: errors.password, hint: true })}
          name="password"
          type="text"
          required
          minLength={10}
          maxLength={200}
          autoComplete="new-password"
          hasError={Boolean(errors.password)}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
