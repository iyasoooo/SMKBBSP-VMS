'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { submitAppointmentRequest } from './actions';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea, fieldAria } from '@/components/ui/field';
import { Alert } from '@/components/ui/surface';
import { IcScanAssist } from '@/components/ocr/ic-scan-assist';
import { MAX_PARTY_SIZE } from '@/lib/constants';
import type { ActionResult } from '@/lib/result';

export interface TeacherOption {
  id: string;
  name: string;
  department: string;
}

export interface DestinationOption {
  id: string;
  nameEn: string;
  instructionsEn: string | null;
}

export interface VisitTypeOption {
  id: string;
  nameEn: string;
  defaultDurationMinutes: number;
  requiresIdSighted: boolean;
}

interface RequestFormProps {
  teachers: TeacherOption[];
  destinations: DestinationOption[];
  visitTypes: VisitTypeOption[];
  openingTime: string;
  closingTime: string;
  minDate: string;
  maxDate: string;
  consentVersion: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
      {pending ? 'Submitting...' : 'Submit request'}
    </Button>
  );
}

export function RequestForm({
  teachers,
  destinations,
  visitTypes,
  openingTime,
  closingTime,
  minDate,
  maxDate,
  consentVersion,
}: RequestFormProps) {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    submitAppointmentRequest,
    null,
  );

  const [identityType, setIdentityType] = useState('NRIC');
  // Controlled only so the optional OCR panel can populate them. They remain
  // ordinary editable inputs; nothing here depends on OCR having run.
  const [fullName, setFullName] = useState('');
  const [identityNumber, setIdentityNumber] = useState('');
  const [visitTypeId, setVisitTypeId] = useState(visitTypes[0]?.id ?? '');
  const [destinationId, setDestinationId] = useState('');

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const formError = state && !state.ok ? state.message : null;

  const selectedVisitType = visitTypes.find((type) => type.id === visitTypeId);
  const selectedDestination = destinations.find((d) => d.id === destinationId);

  const identityHint =
    identityType === 'NRIC'
      ? 'Malaysian identity card number, for example 880101-14-5523.'
      : 'Enter the number exactly as printed on the document you will bring.';

  return (
    <form action={formAction} className="flex flex-col gap-8" noValidate>
      {formError ? (
        <Alert tone="danger" title="Your request was not submitted">
          {formError}
        </Alert>
      ) : null}

      {/* ---------------- Visitor ---------------- */}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold text-[var(--text-strong)]">
          About you
        </legend>

        {/*
          Optional assistance, offered before the fields it fills. It is never
          required: every field below can be typed directly, and the form does
          not know or care whether OCR was used.
        */}
        {identityType === 'NRIC' ? (
          <IcScanAssist
            onApply={(fields) => {
              if (fields.fullName) setFullName(fields.fullName);
              if (fields.identityNumber) setIdentityNumber(fields.identityNumber);
            }}
          />
        ) : null}

        <Field id="fullName" label="Full name" required error={errors.fullName}>
          <Input
            {...fieldAria('fullName', { error: errors.fullName })}
            name="fullName"
            autoComplete="name"
            maxLength={120}
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            hasError={Boolean(errors.fullName)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="email" label="Email address" required error={errors.email}
            hint="Your pass and updates are sent here.">
            <Input
              {...fieldAria('email', { error: errors.email, hint: true })}
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              hasError={Boolean(errors.email)}
            />
          </Field>

          <Field id="phone" label="Phone number" required error={errors.phone}
            hint="For example 012-345 6789.">
            <Input
              {...fieldAria('phone', { error: errors.phone, hint: true })}
              name="phone"
              type="tel"
              autoComplete="tel"
              required
              hasError={Boolean(errors.phone)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="identityType" label="Identification type" required error={errors.identityType}>
            <Select
              {...fieldAria('identityType', { error: errors.identityType })}
              name="identityType"
              value={identityType}
              onChange={(event) => setIdentityType(event.target.value)}
              required
              hasError={Boolean(errors.identityType)}
            >
              <option value="NRIC">Malaysian identity card (MyKad)</option>
              <option value="PASSPORT">Passport</option>
              <option value="DRIVING_LICENCE">Driving licence</option>
              <option value="OTHER">Other official identification</option>
            </Select>
          </Field>

          <Field
            id="identityNumber"
            label="Identification number"
            required
            error={errors.identityNumber}
            hint={identityHint}
          >
            <Input
              {...fieldAria('identityNumber', { error: errors.identityNumber, hint: true })}
              name="identityNumber"
              inputMode={identityType === 'NRIC' ? 'numeric' : 'text'}
              autoComplete="off"
              maxLength={30}
              required
              value={identityNumber}
              onChange={(event) => setIdentityNumber(event.target.value)}
              hasError={Boolean(errors.identityNumber)}
            />
          </Field>
        </div>

        <Field
          id="visitorCategory"
          label="You are visiting as"
          required
          error={errors.visitorCategory}
        >
          <Select
            {...fieldAria('visitorCategory', { error: errors.visitorCategory })}
            name="visitorCategory"
            defaultValue="PARENT"
            required
            hasError={Boolean(errors.visitorCategory)}
          >
            <option value="PARENT">Parent</option>
            <option value="GUARDIAN">Guardian or family member</option>
            <option value="OFFICIAL">Government or education official</option>
            <option value="CONTRACTOR">Contractor or maintenance</option>
            <option value="VENDOR">Supplier or delivery</option>
            <option value="ALUMNI">Alumni</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
      </fieldset>

      {/* ---------------- Visit ---------------- */}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold text-[var(--text-strong)]">
          About your visit
        </legend>

        <Field id="teacherId" label="Teacher you wish to meet" required error={errors.teacherId}>
          <Select
            {...fieldAria('teacherId', { error: errors.teacherId })}
            name="teacherId"
            defaultValue=""
            required
            hasError={Boolean(errors.teacherId)}
          >
            <option value="" disabled>
              Choose a teacher
            </option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name} - {teacher.department}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="visitTypeId" label="Type of visit" required error={errors.visitTypeId}>
            <Select
              {...fieldAria('visitTypeId', { error: errors.visitTypeId })}
              name="visitTypeId"
              value={visitTypeId}
              onChange={(event) => setVisitTypeId(event.target.value)}
              required
              hasError={Boolean(errors.visitTypeId)}
            >
              {visitTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.nameEn} ({type.defaultDurationMinutes} min)
                </option>
              ))}
            </Select>
          </Field>

          <Field id="destinationId" label="Where you are going" error={errors.destinationId}
            hint="Optional. The office can direct you on arrival.">
            <Select
              {...fieldAria('destinationId', { error: errors.destinationId, hint: true })}
              name="destinationId"
              value={destinationId}
              onChange={(event) => setDestinationId(event.target.value)}
              hasError={Boolean(errors.destinationId)}
            >
              <option value="">Not sure / to be advised</option>
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.nameEn}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {selectedDestination?.instructionsEn ? (
          <Alert tone="info">{selectedDestination.instructionsEn}</Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="visitDate"
            label="Date of visit"
            required
            error={errors.visitDate}
            hint="School days only."
          >
            <Input
              {...fieldAria('visitDate', { error: errors.visitDate, hint: true })}
              name="visitDate"
              type="date"
              min={minDate}
              max={maxDate}
              required
              hasError={Boolean(errors.visitDate)}
            />
          </Field>

          <Field
            id="visitTime"
            label="Arrival time"
            required
            error={errors.visitTime}
            hint={`Visiting hours are ${openingTime} to ${closingTime}.`}
          >
            <Input
              {...fieldAria('visitTime', { error: errors.visitTime, hint: true })}
              name="visitTime"
              type="time"
              min={openingTime}
              max={closingTime}
              step={900}
              required
              hasError={Boolean(errors.visitTime)}
            />
          </Field>
        </div>

        {selectedVisitType ? (
          <p className="text-xs text-muted">
            This visit is scheduled for {selectedVisitType.defaultDurationMinutes} minutes and must
            finish by {closingTime}.
            {selectedVisitType.requiresIdSighted
              ? ' Please bring your physical identification; the guard will check it at the gate.'
              : ''}
          </p>
        ) : null}

        <Field
          id="purpose"
          label="Reason for your visit"
          required
          error={errors.purpose}
          hint="A short sentence is enough. This is shared with your host teacher."
        >
          <Textarea
            {...fieldAria('purpose', { error: errors.purpose, hint: true })}
            name="purpose"
            maxLength={500}
            rows={3}
            required
            hasError={Boolean(errors.purpose)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="partySize"
            label="Number of people attending"
            required
            error={errors.partySize}
            hint="Including yourself."
          >
            <Input
              {...fieldAria('partySize', { error: errors.partySize, hint: true })}
              name="partySize"
              type="number"
              min={1}
              max={MAX_PARTY_SIZE}
              defaultValue={1}
              required
              hasError={Boolean(errors.partySize)}
            />
          </Field>

          <Field
            id="vehicleNumber"
            label="Vehicle number"
            error={errors.vehicleNumber}
            hint="Optional. Helps the guard direct you to parking."
          >
            <Input
              {...fieldAria('vehicleNumber', { error: errors.vehicleNumber, hint: true })}
              name="vehicleNumber"
              maxLength={15}
              autoCapitalize="characters"
              hasError={Boolean(errors.vehicleNumber)}
            />
          </Field>
        </div>
      </fieldset>

      {/* ---------------- Consent ---------------- */}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-[var(--text-strong)]">
          Privacy and consent
        </legend>

        <div className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-inset)] p-4 text-sm leading-relaxed text-muted">
          <p>
            The school collects your name, contact details, identification number and visit details
            in order to authorise your visit, produce your visitor pass, and keep a record of who
            was on the school grounds. Your identification number is encrypted and is shown to staff
            in masked form. Records are kept for the school&apos;s retention period and are not
            shared outside the school except where the law requires it.
          </p>
          <p className="mt-2">
            Your QR pass authorises an approved appointment. It does not verify your identity, which
            is why the guard also checks your physical identification at the gate.
          </p>
          <p className="mt-2 text-xs">Notice version {consentVersion}</p>
        </div>

        <Checkbox
          id="consent"
          name="consent"
          error={errors.consent}
          label="I have read the notice above and agree to the school recording these details for this visit."
        />
      </fieldset>

      <div className="flex flex-col gap-3 border-t border-[var(--line-soft)] pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted">
          Your request is not confirmed until your host teacher approves it.
        </p>
        <SubmitButton />
      </div>
    </form>
  );
}
