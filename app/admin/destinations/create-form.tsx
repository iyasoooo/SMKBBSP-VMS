'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createDestinationAction } from '@/app/admin/actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea, fieldAria } from '@/components/ui/field';
import { Alert } from '@/components/ui/surface';
import type { ActionResult } from '@/lib/result';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving...' : 'Add destination'}
    </Button>
  );
}

export function DestinationCreateForm() {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    createDestinationAction,
    null,
  );

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4" noValidate>
      {state && !state.ok ? <Alert tone="danger">{state.message}</Alert> : null}
      {state?.ok ? <Alert tone="success">Destination added.</Alert> : null}

      <Field id="d-code" label="Code" required error={errors.code}
        hint="Short uppercase identifier, e.g. LIBRARY.">
        <Input
          {...fieldAria('d-code', { error: errors.code, hint: true })}
          name="code"
          required
          maxLength={12}
          autoCapitalize="characters"
          className="font-mono uppercase"
          hasError={Boolean(errors.code)}
        />
      </Field>

      <Field id="d-nameEn" label="Name (English)" required error={errors.nameEn}>
        <Input
          {...fieldAria('d-nameEn', { error: errors.nameEn })}
          name="nameEn"
          required
          maxLength={80}
          hasError={Boolean(errors.nameEn)}
        />
      </Field>

      <Field id="d-nameMs" label="Nama (Bahasa Melayu)" required error={errors.nameMs}>
        <Input
          {...fieldAria('d-nameMs', { error: errors.nameMs })}
          name="nameMs"
          required
          maxLength={80}
          hasError={Boolean(errors.nameMs)}
        />
      </Field>

      <Field id="d-insEn" label="Directions (English)" error={errors.instructionsEn}
        hint="Shown to the visitor on their pass.">
        <Textarea
          {...fieldAria('d-insEn', { error: errors.instructionsEn, hint: true })}
          name="instructionsEn"
          rows={2}
          maxLength={300}
        />
      </Field>

      <Field id="d-insMs" label="Arahan (Bahasa Melayu)" error={errors.instructionsMs}>
        <Textarea
          {...fieldAria('d-insMs', { error: errors.instructionsMs })}
          name="instructionsMs"
          rows={2}
          maxLength={300}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
