'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createBlacklistAction } from '@/app/admin/actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea, fieldAria } from '@/components/ui/field';
import { Alert } from '@/components/ui/surface';
import type { ActionResult } from '@/lib/result';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" disabled={pending}>
      {pending ? 'Saving...' : 'Add entry'}
    </Button>
  );
}

export function BlacklistCreateForm() {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    createBlacklistAction,
    null,
  );

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4" noValidate>
      {state && !state.ok ? <Alert tone="danger">{state.message}</Alert> : null}
      {state?.ok ? <Alert tone="success">Entry added and recorded in the audit log.</Alert> : null}

      <Field id="bl-name" label="Name on the entry" required error={errors.displayName}
        hint="For identification in this list only. Never used for matching.">
        <Input
          {...fieldAria('bl-name', { error: errors.displayName, hint: true })}
          name="displayName"
          required
          maxLength={120}
          hasError={Boolean(errors.displayName)}
        />
      </Field>

      <fieldset className="rounded-lg border border-[var(--line-soft)] p-3">
        <legend className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
          Match on at least one
        </legend>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <Field id="bl-idtype" label="ID type">
              <Select id="bl-idtype" name="identityType" defaultValue="NRIC">
                <option value="NRIC">MyKad</option>
                <option value="PASSPORT">Passport</option>
                <option value="DRIVING_LICENCE">Licence</option>
                <option value="OTHER">Other</option>
              </Select>
            </Field>

            <Field id="bl-idnum" label="Identity number" error={errors.identityNumber}>
              <Input
                {...fieldAria('bl-idnum', { error: errors.identityNumber })}
                name="identityNumber"
                maxLength={30}
                autoComplete="off"
                hasError={Boolean(errors.identityNumber)}
              />
            </Field>
          </div>

          <Field id="bl-phone" label="Phone number" error={errors.phone}>
            <Input {...fieldAria('bl-phone', { error: errors.phone })} name="phone" maxLength={30} />
          </Field>

          <Field id="bl-email" label="Email address" error={errors.email}>
            <Input
              {...fieldAria('bl-email', { error: errors.email })}
              name="email"
              type="email"
              maxLength={254}
              autoCapitalize="none"
            />
          </Field>
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="bl-policy" label="Match policy" required>
          <Select id="bl-policy" name="matchPolicy" defaultValue="REVIEW" required>
            <option value="REVIEW">Review - hold for an administrator</option>
            <option value="BLOCK">Block - refuse approval and check-in</option>
          </Select>
        </Field>

        <Field id="bl-category" label="Category" required>
          <Select id="bl-category" name="category" defaultValue="OTHER" required>
            <option value="SECURITY_INCIDENT">Security incident</option>
            <option value="TRESPASS">Trespass</option>
            <option value="HARASSMENT">Harassment</option>
            <option value="COURT_ORDER">Court order</option>
            <option value="CUSTODY_DISPUTE">Custody dispute</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
      </div>

      <Field
        id="bl-until"
        label="Effective until"
        hint="Leave blank for no end date."
      >
        <Input {...fieldAria('bl-until', { hint: true })} name="validUntil" type="date" />
      </Field>

      <Field
        id="bl-reason"
        label="Internal reason"
        required
        error={errors.reason}
        hint="Restricted. Never shown to guards, teachers, the visitor, or in exports."
      >
        <Textarea
          {...fieldAria('bl-reason', { error: errors.reason, hint: true })}
          name="reason"
          rows={3}
          required
          minLength={10}
          maxLength={1000}
          hasError={Boolean(errors.reason)}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
