'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { walkInAction } from '@/app/guard/actions';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea, fieldAria } from '@/components/ui/field';
import { SearchableSelect, type SearchableOption } from '@/components/ui/searchable-select';
import { Alert } from '@/components/ui/surface';
import { MAX_PARTY_SIZE } from '@/lib/constants';
import type { GuardDictionary } from '@/lib/i18n/dictionary';
import type { ActionResult } from '@/lib/result';

export interface WalkInOptions {
  teachers: Array<{ id: string; name: string; department: string }>;
  destinations: Array<{
    id: string;
    nameEn: string;
    nameMs: string;
    block: string | null;
    levelName: string | null;
  }>;
  visitTypes: Array<{ id: string; nameEn: string; defaultDurationMinutes: number; requiresIdSighted: boolean }>;
}

function SubmitButton({ label, busyLabel }: { label: string; busyLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
      {pending ? busyLabel : label}
    </Button>
  );
}

/**
 * Walk-in registration, laid out for a tablet at the guard house.
 *
 * Controls are full-height (44px minimum) and the form is single-column on
 * narrow screens so it stays usable one-handed while the visitor waits.
 */
export function WalkInForm({ options, t }: { options: WalkInOptions; t: GuardDictionary }) {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    walkInAction,
    null,
  );

  const [visitTypeId, setVisitTypeId] = useState(options.visitTypes[0]?.id ?? '');
  const [idSighted, setIdSighted] = useState(false);
  const [destinationId, setDestinationId] = useState('');

  // Block and level separate the rooms that share a name; the Malay name is
  // searchable because that is what a guard is told at the gate.
  const destinationOptions: SearchableOption[] = options.destinations.map((destination) => {
    const where = [destination.levelName, destination.block ? `Block ${destination.block}` : null]
      .filter(Boolean)
      .join(' · ');

    return {
      value: destination.id,
      label: destination.nameEn,
      detail: where || undefined,
      keywords: destination.nameMs,
    };
  });

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const formError = state && !state.ok ? state.message : null;
  const blocked = state && !state.ok && state.code === 'BLOCKED';

  const selectedType = options.visitTypes.find((type) => type.id === visitTypeId);
  const requiresId = selectedType?.requiresIdSighted ?? true;

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {blocked ? (
        <Alert tone="danger" title={t.statusBlocked}>
          {t.walkInBlocked}
        </Alert>
      ) : formError ? (
        <Alert tone="danger">{formError}</Alert>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-[var(--text-strong)]">
          {t.visitor}
        </legend>

        <Field id="fullName" label={t.visitorName} required error={errors.fullName}>
          <Input
            {...fieldAria('fullName', { error: errors.fullName })}
            name="fullName"
            required
            maxLength={120}
            className="h-12 text-base"
            hasError={Boolean(errors.fullName)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="phone" label={t.phone} required error={errors.phone}>
            <Input
              {...fieldAria('phone', { error: errors.phone })}
              name="phone"
              type="tel"
              inputMode="tel"
              required
              className="h-12 text-base"
              hasError={Boolean(errors.phone)}
            />
          </Field>

          <Field id="email" label={`${t.email} (${t.emailOptional})`} error={errors.email}>
            <Input
              {...fieldAria('email', { error: errors.email })}
              name="email"
              type="email"
              autoCapitalize="none"
              spellCheck={false}
              className="h-12 text-base"
              hasError={Boolean(errors.email)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="identityType" label={t.identityType} required error={errors.identityType}>
            <Select
              {...fieldAria('identityType', { error: errors.identityType })}
              name="identityType"
              defaultValue="NRIC"
              required
              className="h-12 text-base"
            >
              <option value="NRIC">MyKad</option>
              <option value="PASSPORT">Passport</option>
              <option value="DRIVING_LICENCE">Driving licence</option>
              <option value="OTHER">Other</option>
            </Select>
          </Field>

          <Field
            id="identityNumber"
            label={t.identityNumber}
            required
            error={errors.identityNumber}
          >
            <Input
              {...fieldAria('identityNumber', { error: errors.identityNumber })}
              name="identityNumber"
              required
              autoComplete="off"
              maxLength={30}
              className="h-12 font-mono text-base"
              hasError={Boolean(errors.identityNumber)}
            />
          </Field>
        </div>

        <Field id="visitorCategory" label="Category" required error={errors.visitorCategory}>
          <Select
            {...fieldAria('visitorCategory', { error: errors.visitorCategory })}
            name="visitorCategory"
            defaultValue="PARENT"
            required
            className="h-12 text-base"
          >
            <option value="PARENT">Parent</option>
            <option value="GUARDIAN">Guardian</option>
            <option value="OFFICIAL">Official</option>
            <option value="CONTRACTOR">Contractor</option>
            <option value="VENDOR">Vendor / delivery</option>
            <option value="ALUMNI">Alumni</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-[var(--text-strong)]">Visit</legend>

        <Field id="teacherId" label={t.host} required error={errors.teacherId}>
          <Select
            {...fieldAria('teacherId', { error: errors.teacherId })}
            name="teacherId"
            defaultValue=""
            required
            className="h-12 text-base"
            hasError={Boolean(errors.teacherId)}
          >
            <option value="" disabled>
              -
            </option>
            {options.teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name} - {teacher.department}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="visitTypeId" label={t.visitType} required error={errors.visitTypeId}>
            <Select
              {...fieldAria('visitTypeId', { error: errors.visitTypeId })}
              name="visitTypeId"
              value={visitTypeId}
              onChange={(event) => setVisitTypeId(event.target.value)}
              required
              className="h-12 text-base"
            >
              {options.visitTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.nameEn}
                </option>
              ))}
            </Select>
          </Field>

          {/*
            Searchable for the same reason the public form is: the school has
            ninety places, and scrolling a native dropdown that long on a tablet
            at the gate - with a visitor waiting - is the worst version of this
            control. The guard can type two letters instead.
          */}
          <Field id="destinationId" label={t.destination} error={errors.destinationId}>
            <SearchableSelect
              id="destinationId"
              name="destinationId"
              value={destinationId}
              onChange={setDestinationId}
              options={destinationOptions}
              emptyOption="-"
              placeholder={t.destinationSearch}
              hasError={Boolean(errors.destinationId)}
              describedBy={
                fieldAria('destinationId', { error: errors.destinationId })['aria-describedby']
              }
            />
          </Field>
        </div>

        <Field id="purpose" label={t.purpose} required error={errors.purpose}>
          <Textarea
            {...fieldAria('purpose', { error: errors.purpose })}
            name="purpose"
            rows={2}
            maxLength={500}
            required
            className="text-base"
            hasError={Boolean(errors.purpose)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="partySize" label={t.partySize} required error={errors.partySize}>
            <Input
              {...fieldAria('partySize', { error: errors.partySize })}
              name="partySize"
              type="number"
              min={1}
              max={MAX_PARTY_SIZE}
              defaultValue={1}
              required
              className="h-12 text-base"
            />
          </Field>

          <Field
            id="expectedDurationMinutes"
            label={`${t.expectedDuration} (${t.minutes})`}
            required
            error={errors.expectedDurationMinutes}
          >
            <Input
              {...fieldAria('expectedDurationMinutes', { error: errors.expectedDurationMinutes })}
              name="expectedDurationMinutes"
              type="number"
              min={5}
              max={600}
              step={5}
              key={selectedType?.id}
              defaultValue={selectedType?.defaultDurationMinutes ?? 30}
              required
              className="h-12 text-base"
            />
          </Field>

          <Field id="vehicleNumber" label={t.vehicle} error={errors.vehicleNumber}>
            <Input
              {...fieldAria('vehicleNumber', { error: errors.vehicleNumber })}
              name="vehicleNumber"
              maxLength={15}
              autoCapitalize="characters"
              className="h-12 text-base"
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-inset)] p-4">
        <legend className="px-1 text-sm font-semibold text-[var(--text-strong)]">
          {t.identity}
        </legend>

        {requiresId ? (
          <>
            <Checkbox
              id="idSighted"
              name="idSighted"
              checked={idSighted}
              onChange={(event) => setIdSighted(event.target.checked)}
              label={<span className="font-medium">{t.confirmIdSighted}</span>}
            />
            <p className="text-xs text-muted">{t.idSightedHelp}</p>
          </>
        ) : (
          <p className="text-sm text-muted">{t.idNotRequired}</p>
        )}
      </fieldset>

      <div className="flex flex-col gap-3 border-t border-[var(--line-soft)] pt-5 sm:flex-row sm:items-center sm:justify-end">
        <SubmitButton label={t.registerAndCheckIn} busyLabel={t.loading} />
      </div>
    </form>
  );
}
