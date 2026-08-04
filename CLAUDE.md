# Claude Code project instructions

This file contains persistent instructions for Claude Code. Keep it concise and update it only when a verified project decision changes.

## Source of truth

Read before implementation:

- `docs/spec/PROJECT_SPEC.md` - product, workflow, data, and architecture contract.
- `docs/spec/IMPLEMENTATION_PLAN.md` - required build order and completion checklist.
- `docs/spec/ACCEPTANCE_TESTS.md` - executable definition of done.
- `docs/spec/FYP_SCOPE_REVISION.md` - academic scope boundaries and honest claims.

When documents conflict, use this priority: `docs/spec/PROJECT_SPEC.md`, `docs/spec/ACCEPTANCE_TESTS.md`, `docs/spec/IMPLEMENTATION_PLAN.md`, then other prose. Do not silently invent a materially different workflow.

## Product boundary

Build SMKBBSP VisitorPass: a QR and appointment-based school visitor management web application.

Excluded permanently: MyDigitalID, Keycloak, biometrics, face recognition, machine-learning anomaly detection, license-plate recognition, geofencing, continuous tracking, chatbots, and paid-service requirements.

OCR is form assistance only. It is never identity verification, and the IC image must not be persisted.

## Stack and commands

- Next.js App Router, TypeScript strict, Tailwind CSS.
- PostgreSQL 16 with the current generally available Prisma ORM.
- Node.js 22 LTS and npm.
- Mailpit through SMTP for local email.
- Vitest and Playwright.

Keep these scripts working:

- `npm run dev`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run test:e2e`
- `npm run build`
- `npm run db:migrate`
- `npm run db:seed`
- `npm run db:reset`

## Engineering rules

- Prefer Server Components for reads and server actions or route handlers for mutations.
- Validate every mutation input with Zod on the server.
- Enforce authorization in the server/data layer. Hiding UI is not authorization.
- Keep business transitions in service modules, not React components.
- Use database transactions for status transitions that write multiple records.
- Store timestamps in UTC and render them in `Asia/Kuala_Lumpur`.
- Use typed enums/constants for roles and statuses.
- Do not put secrets or personal data in source, fixtures, URLs, QR payloads, logs, or error messages.
- Do not use in-memory arrays as application persistence.
- Avoid `any`, ignored TypeScript errors, disabled lint rules, and unvalidated casts.
- Add tests for every bug fix and security-sensitive branch.
- Use accessible semantic HTML, visible focus styles, labels, keyboard operation, and minimum 44px touch targets on guard screens.

## Authentication and authorization

Roles: `ADMIN`, `GUARD`, `TEACHER`.

- Admin: full system administration, reporting, blacklist, users, destinations, audit.
- Guard: today's approved visits, walk-ins, identity sighting confirmation, check-in/out, badge printing, emergency list.
- Teacher: own appointment queue and own visit history only.
- Visitor: no account; can submit and view a request through expiring opaque tokens.

Sessions are database-backed and revocable. Cookies are `httpOnly`, `sameSite=lax`, path `/`, production-only `secure`, and expire. Rotate or revoke sessions after password/security changes.

## Privacy and security invariants

- QR tokens are random, opaque, expiring, revocable, and stored hashed.
- NRIC/passport values are normalized server-side, encrypted with AES-256-GCM when retrieval is required, and separately HMACed for matching. Mask by default.
- Never retain OCR images.
- A blacklist match blocks automatic approval and check-in until an authorized admin resolves it.
- Public appointment lookup must use an unguessable token and reveal only that visitor's request.
- Audit login failures/successes appropriately without logging credentials; audit approval, rejection, check-in, check-out, manual overrides, blacklist and user changes, exports, and sensitive reveals.

## Workflow invariants

- Appointment: `PENDING -> APPROVED | REJECTED | CANCELLED | EXPIRED`.
- Approved appointment may create one visit/pass. Rejection never creates a usable pass.
- Visit: `EXPECTED -> CHECKED_IN -> CHECKED_OUT`; alternate terminal states are `CANCELLED`, `NO_SHOW`, and `DENIED`.
- Check-in requires an approved/current appointment or a completed guard walk-in registration, no active blacklist block, and guard confirmation that physical ID was sighted when required.
- Check-out requires `CHECKED_IN` and records the responsible guard.
- Repeat scans are idempotent and return the current state rather than duplicating events.

## UI rules

- Prioritize the guard tablet workflow.
- Main guard labels support Bahasa Melayu and English; remember the selected language locally.
- Provide dark mode.
- Use database-backed empty, error, loading, and confirmation states.
- Avoid decorative metrics and fake charts. All dashboard values come from queries.
- Print views must hide navigation and fit an A4 badge/pass layout cleanly.

## Completion discipline

Do not stop at scaffolding. Run checks after each major slice and all checks before declaring completion. Do not mark plan items complete until code and tests exist. Do not deploy, push, or create external accounts unless the user separately authorizes it.
