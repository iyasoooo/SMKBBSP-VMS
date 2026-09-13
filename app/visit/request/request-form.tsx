'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { submitAppointmentRequest } from './actions';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea, fieldAria } from '@/components/ui/field';
import { SearchableSelect, type SearchableOption } from '@/components/ui/searchable-select';
import { Alert, Card } from '@/components/ui/surface';
import { IcScanAssist } from '@/components/ocr/ic-scan-assist';
import { MAX_PARTY_SIZE } from '@/lib/constants';
import type { ActionResult } from '@/lib/result';

export interface TeacherOption {
  id: string;
  name: string;
}

export interface DestinationOption {
  id: string;
  nameEn: string;
  /** Searchable, though not displayed - see `destinationOptions`. */
  nameMs: string;
  instructionsEn: string | null;
  /** Where it is on the plan, for telling same-named rooms apart. */
  block: string | null;
  levelName: string | null;
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
  /** The day the picker opens on: the next day the school is actually open. */
  defaultDate: string;
  maxDate: string;
  consentVersion: string;
}

/** One accompanying person, as held in form state. */
interface CompanionDraft {
  fullName: string;
  relation: string;
  phone: string;
  identityNumber: string;
}

const emptyCompanion = (): CompanionDraft => ({
  fullName: '',
  relation: '',
  phone: '',
  identityNumber: '',
});

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
  defaultDate,
  maxDate,
  consentVersion,
}: RequestFormProps) {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    submitAppointmentRequest,
    null,
  );

  /*
   * Every field is controlled.
   *
   * React resets an uncontrolled form once its action resolves, so a rejected
   * submission used to wipe everything the visitor had typed - including a
   * twelve-digit identity number - and hand back a blank form with an error on
   * it. Holding the values in state means a rejection costs the visitor only
   * the field that was actually wrong.
   */
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [identityType, setIdentityType] = useState('NRIC');
  const [identityNumber, setIdentityNumber] = useState('');
  const [visitorCategory, setVisitorCategory] = useState('PARENT');
  const [teacherId, setTeacherId] = useState('');
  const [visitTypeId, setVisitTypeId] = useState(visitTypes[0]?.id ?? '');
  const [destinationId, setDestinationId] = useState('');
  /*
   * Starts on the next open school day rather than empty. Most requests are for
   * today or tomorrow, so this is one fewer thing to fill in - and the visitor
   * can still change it. It is only a starting value: the server checks the day
   * again, because a preset is a convenience and never an authorisation.
   */
  const [visitDate, setVisitDate] = useState(defaultDate);
  const [visitTime, setVisitTime] = useState('');
  const [purpose, setPurpose] = useState('');
  const [partySize, setPartySize] = useState(1);
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [consent, setConsent] = useState(false);
  const [companions, setCompanions] = useState<CompanionDraft[]>([]);

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const formError = state && !state.ok ? state.message : null;

  /*
   * Clear only what was rejected.
   *
   * A field the server complained about is worth retyping; the fifteen it
   * accepted are not. Consent is reset on any failure by design - an agreement
   * should be given against the details actually being submitted, not inherited
   * from an earlier attempt.
   */
  useEffect(() => {
    if (!state || state.ok) return;
    const rejected = state.fieldErrors ?? {};

    if (rejected.fullName) setFullName('');
    if (rejected.email) setEmail('');
    if (rejected.phone) setPhone('');
    if (rejected.identityNumber) setIdentityNumber('');
    if (rejected.visitDate) setVisitDate('');
    if (rejected.visitTime) setVisitTime('');
    if (rejected.purpose) setPurpose('');
    if (rejected.vehicleNumber) setVehicleNumber('');
    if (rejected.teacherId) setTeacherId('');

    setCompanions((current) =>
      current.map((companion, index) => ({
        fullName: rejected[`companions.${index}.fullName`] ? '' : companion.fullName,
        relation: rejected[`companions.${index}.relation`] ? '' : companion.relation,
        phone: rejected[`companions.${index}.phone`] ? '' : companion.phone,
        identityNumber: rejected[`companions.${index}.identityNumber`]
          ? ''
          : companion.identityNumber,
      })),
    );

    setConsent(false);
  }, [state]);

  /** Keep the companion rows in step with the number attending. */
  function changePartySize(next: number) {
    const size = Number.isFinite(next) ? Math.min(MAX_PARTY_SIZE, Math.max(1, next)) : 1;
    setPartySize(size);
    setCompanions((current) => {
      const wanted = size - 1;
      if (current.length === wanted) return current;
      if (current.length < wanted) {
        return [...current, ...Array.from({ length: wanted - current.length }, emptyCompanion)];
      }
      // Trim from the end so earlier entries the visitor already typed survive.
      return current.slice(0, wanted);
    });
  }

  function updateCompanion(index: number, patch: Partial<CompanionDraft>) {
    setCompanions((current) =>
      current.map((companion, i) => (i === index ? { ...companion, ...patch } : companion)),
    );
  }

  const selectedVisitType = visitTypes.find((type) => type.id === visitTypeId);
  const selectedDestination = destinations.find((d) => d.id === destinationId);

  /*
   * The picker's rows.
   *
   * `detail` is the block and level, which is what separates the several rooms
   * that share a name - the school has more than one science room and more than
   * one computer lab, and a bare name asks the visitor to guess. The same text
   * is searchable, so "block b" narrows the list as readily as a room name does.
   */
  const destinationOptions: SearchableOption[] = destinations.map((destination) => {
    const where = [destination.levelName, destination.block ? `Block ${destination.block}` : null]
      .filter(Boolean)
      .join(' · ');

    return {
      value: destination.id,
      label: destination.nameEn,
      detail: where || undefined,
      /*
       * The Malay name is searchable but not shown. This is a Malaysian school
       * and a parent told to go to "Bilik Sains" will type that, not "Science
       * room" - without it the search silently returns nothing for the name the
       * visitor was actually given. Showing both would double the length of
       * every row for a gain the detail line already covers.
       */
      keywords: destination.nameMs,
    };
  });

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
        <legend className="mb-2 text-sm font-semibold text-[var(--text-strong)]">About you</legend>

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
          <Field
            id="email"
            label="Email address"
            required
            error={errors.email}
            hint="Your pass and updates are sent here."
          >
            <Input
              {...fieldAria('email', { error: errors.email, hint: true })}
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              hasError={Boolean(errors.email)}
            />
          </Field>

          <Field
            id="phone"
            label="Phone number"
            required
            error={errors.phone}
            hint="For example 012-345 6789."
          >
            <Input
              {...fieldAria('phone', { error: errors.phone, hint: true })}
              name="phone"
              type="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
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
            value={visitorCategory}
            onChange={(event) => setVisitorCategory(event.target.value)}
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

        <Field id="teacherId" label="Staff you wish to meet" required error={errors.teacherId}>
          <Select
            {...fieldAria('teacherId', { error: errors.teacherId })}
            name="teacherId"
            value={teacherId}
            onChange={(event) => setTeacherId(event.target.value)}
            required
            hasError={Boolean(errors.teacherId)}
          >
            <option value="" disabled>
              Choose a staff member
            </option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name}
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

          <Field
            id="destinationId"
            label="Where you are going"
            error={errors.destinationId}
            hint="Optional. Type to search, or leave it for the office to direct you."
          >
            <SearchableSelect
              id="destinationId"
              name="destinationId"
              value={destinationId}
              onChange={setDestinationId}
              options={destinationOptions}
              emptyOption="Not sure / to be advised"
              placeholder="Search for a room, block or level"
              hasError={Boolean(errors.destinationId)}
              describedBy={
                fieldAria('destinationId', { error: errors.destinationId, hint: true })[
                  'aria-describedby'
                ]
              }
            />
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
              value={visitDate}
              onChange={(event) => setVisitDate(event.target.value)}
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
              value={visitTime}
              onChange={(event) => setVisitTime(event.target.value)}
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
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
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
              required
              value={partySize}
              onChange={(event) => changePartySize(Number(event.target.value))}
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
              value={vehicleNumber}
              onChange={(event) => setVehicleNumber(event.target.value.toUpperCase())}
              hasError={Boolean(errors.vehicleNumber)}
            />
          </Field>
        </div>
      </fieldset>

      {/* ---------------- Companions ---------------- */}
      {companions.length > 0 ? (
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold text-[var(--text-strong)]">
            Who is coming with you
          </legend>
          <p className="-mt-2 text-sm text-muted">
            The school records everyone on the grounds, not just how many people are expected.
            Please give details for the {companions.length} other{' '}
            {companions.length === 1 ? 'person' : 'people'} attending.
          </p>

          {companions.map((companion, index) => (
            <Card key={index} className="p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-strong)]">
                Person {index + 2}
              </p>

              <div className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    id={`companion-${index}-name`}
                    label="Full name"
                    required
                    error={errors[`companions.${index}.fullName`]}
                  >
                    <Input
                      {...fieldAria(`companion-${index}-name`, {
                        error: errors[`companions.${index}.fullName`],
                      })}
                      name={`companions.${index}.fullName`}
                      maxLength={120}
                      required
                      value={companion.fullName}
                      onChange={(event) => updateCompanion(index, { fullName: event.target.value })}
                      hasError={Boolean(errors[`companions.${index}.fullName`])}
                    />
                  </Field>

                  <Field
                    id={`companion-${index}-relation`}
                    label="Relationship to you"
                    required
                    error={errors[`companions.${index}.relation`]}
                    hint="For example Spouse, Son, Colleague."
                  >
                    <Input
                      {...fieldAria(`companion-${index}-relation`, {
                        error: errors[`companions.${index}.relation`],
                        hint: true,
                      })}
                      name={`companions.${index}.relation`}
                      maxLength={40}
                      required
                      value={companion.relation}
                      onChange={(event) => updateCompanion(index, { relation: event.target.value })}
                      hasError={Boolean(errors[`companions.${index}.relation`])}
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    id={`companion-${index}-ic`}
                    label="Identification number"
                    required
                    error={errors[`companions.${index}.identityNumber`]}
                    hint="Malaysian identity card, or passport number."
                  >
                    <Input
                      {...fieldAria(`companion-${index}-ic`, {
                        error: errors[`companions.${index}.identityNumber`],
                        hint: true,
                      })}
                      name={`companions.${index}.identityNumber`}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={30}
                      required
                      value={companion.identityNumber}
                      onChange={(event) =>
                        updateCompanion(index, { identityNumber: event.target.value })
                      }
                      hasError={Boolean(errors[`companions.${index}.identityNumber`])}
                    />
                  </Field>

                  <Field
                    id={`companion-${index}-phone`}
                    label="Phone number"
                    error={errors[`companions.${index}.phone`]}
                    hint="Optional."
                  >
                    <Input
                      {...fieldAria(`companion-${index}-phone`, {
                        error: errors[`companions.${index}.phone`],
                        hint: true,
                      })}
                      name={`companions.${index}.phone`}
                      type="tel"
                      maxLength={30}
                      value={companion.phone}
                      onChange={(event) => updateCompanion(index, { phone: event.target.value })}
                      hasError={Boolean(errors[`companions.${index}.phone`])}
                    />
                  </Field>
                </div>
              </div>
            </Card>
          ))}
        </fieldset>
      ) : null}

      {/* ---------------- Consent ---------------- */}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-[var(--text-strong)]">
          Privacy and consent
        </legend>

        <div className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-inset)] p-4 text-sm leading-relaxed text-muted">
          <p>
            The school collects your name, contact details, identification number and visit details
            in order to authorise your visit, produce your visitor pass, and keep a record of who
            was on the school grounds. Identification numbers are encrypted and are shown to staff
            in masked form. Records are kept for the school&apos;s retention period and are not
            shared outside the school except where the law requires it.
          </p>
          {/*
            The card photograph, stated plainly.

            This has to match what the system actually does, not what sounds
            most reassuring. The image is posted to the school's own reader to
            have its text extracted, so it does leave this browser - claiming
            otherwise would be false. What is true, and what matters, is that it
            is used for that one request and is never written to the database or
            to disk. Only the text the visitor reviews and accepts is stored.
          */}
          <p className="mt-2">
            If you use the card scanner, the photograph of your identity card is sent to the
            school&apos;s own reader, used once to read the text, and is never stored in our
            database or saved to disk. Only the details you check and accept are kept.
          </p>
          {companions.length > 0 ? (
            <p className="mt-2">
              The same applies to everyone attending with you. Please make sure they are aware
              before you submit these details on their behalf.
            </p>
          ) : null}
          <p className="mt-2">
            Your QR pass authorises an approved appointment. It does not verify your identity, which
            is why the guard also checks your physical identification at the gate.
          </p>
          <p className="mt-2 text-xs">Notice version {consentVersion}</p>
        </div>

        <Checkbox
          id="consent"
          name="consent"
          required
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          error={errors.consent}
          label={
            <>
              I have read the notice above and agree to the school recording these details for this
              visit.
              <span className="ml-1 font-semibold text-[var(--danger-text)]" aria-hidden="true">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          }
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
