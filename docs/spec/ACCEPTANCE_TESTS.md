# Acceptance Tests

These scenarios are the executable product contract. P0 scenarios must pass before completion. Automate critical paths in Playwright and lower-level branches in integration/unit tests.

## Test conventions

- Use only deterministic fictional data and reserved `.test` email domains.
- Freeze or control time for expiry and timezone tests.
- Run database-changing scenarios in isolated test data or reset state.
- Verify database/audit effects in addition to visible UI.
- Assert that responses and logs do not expose raw identity values or tokens.

## AT-001 - Staff login and role landing [P0]

Given active Admin, Guard, and Teacher accounts, when each signs in with valid credentials, then each is redirected to the correct role home and receives a secure database-backed session. Invalid credentials return a generic error and create no session.

## AT-002 - Cross-role access is denied [P0]

Given a Teacher session, when the user requests Guard or Admin pages or invokes their mutations directly, then access is denied without rendering protected data. Equivalent tests cover Guard-to-Admin and one Teacher accessing another Teacher's request.

## AT-003 - Submit an online appointment [P0]

Given an active teacher, destination, and visit type, when a visitor submits valid future appointment data and consent, then one visitor/request is stored as `PENDING`, a safe reference is shown, a private status email is queued/sent, the assigned teacher is notified, and no raw token or identity number appears in logs or the public success URL.

## AT-004 - Reject invalid request data [P0]

Given the public form, when the visitor submits a past time, closed-hours time, inactive host, malformed contact/NRIC, missing consent, or excessive party size, then the server rejects it with field-specific safe errors and creates no partial appointment.

## AT-005 - Blacklist review on public submission [P0]

Given an active hard-block identity entry, when a matching visitor submits a request, then the system does not disclose the blacklist publicly, creates a review-safe state according to the specification, alerts an Admin, and does not issue an approval-ready pass.

## AT-006 - Teacher approves a request [P0]

Given a Teacher's own `PENDING` request, when the Teacher approves it, then a single transaction produces `APPROVED`, exactly one `EXPECTED` visit, exactly one active expiring QR credential, visitor notification, and audit entry. Repeating the approval does not duplicate any of them.

## AT-007 - Teacher rejects a request [P0]

Given a Teacher's own `PENDING` request, when the Teacher rejects with a visitor-safe reason, then status is `REJECTED`, the visitor sees/receives the decision, no usable QR credential exists, and the decision is audited.

## AT-008 - Private visitor link isolation [P0]

Given two visitor requests, when visitor A opens A's private token, then only A's safe request details appear. A random, expired, revoked, or altered token returns a generic unavailable message and leaks no existence or identity information.

## AT-009 - QR payload privacy [P0]

Given an approved appointment, when its QR is decoded, then the payload is only an opaque high-entropy token or pass URL containing that token. It contains no name, NRIC/passport, email, phone, host, purpose, or sequential database ID.

## AT-010 - Valid approved check-in [P0]

Given an approved appointment within its valid gate window and no blacklist block, when the Guard scans the pass, confirms required physical-ID sighting, and checks in, then the visit becomes `CHECKED_IN`, timestamps and Guard are recorded in Kuala Lumpur display time/UTC storage, a badge number is created, host notification is queued, and audit/event records exist.

## AT-011 - Invalid pass states [P0]

Given too-early, expired, revoked, cancelled, rejected, unknown, and already-completed passes, when each is scanned or typed, then the Guard receives the correct safe operational state and no invalid check-in is written.

## AT-012 - Repeat scan/check-in is idempotent [P0]

Given a checked-in visit, when its QR is scanned repeatedly or the check-in action is resubmitted, then the existing active visit is shown and no duplicate visit, badge, notification, or check-in event is created.

## AT-013 - Camera denial fallback [P0]

Given camera permission is denied or no camera is available, when the Guard opens scan, then a clear message and manual fallback-code input remain usable without a page failure.

## AT-014 - Clear walk-in [P0]

Given a visitor with no blacklist match, when the Guard completes the walk-in form and required ID-sighting confirmation, then the system creates a `WALK_IN` source record and a `CHECKED_IN` visit, assigns a badge, notifies the host when contact exists, and writes audit/event records.

## AT-015 - Blocked walk-in [P0]

Given a hard-block identity match, when the Guard submits a walk-in, then check-in is not created, the Guard sees a neutral contact-admin instruction, restricted reason details are hidden, and the attempt is safely audited for Admin review.

## AT-016 - Check-out [P0]

Given a `CHECKED_IN` visit, when the Guard checks it out from scan or the active list, then it becomes `CHECKED_OUT`, time and Guard are recorded, it disappears from the emergency list, and audit/event records exist. Repeating checkout changes nothing.

## AT-017 - Badge privacy and print [P0]

Given an active visit, when the badge is viewed and printed, then it contains the required visit fields and QR but no identity number, email, phone, detailed purpose, or blacklist state; navigation is hidden and content fits the intended A4 print layout.

## AT-018 - Emergency list accuracy [P0]

Given one normal active visit with party size 1, one overdue active visit with party size 3, and completed/expected visits, when an authorized user opens the emergency list, then only the two active visits appear, the people total is 4, the overdue row is clear, generated time is displayed, and the print view excludes sensitive fields.

## AT-019 - History filters and masking [P0]

Given seeded history, when an Admin filters by date, host, destination, type, source, and status, then results and totals match the combined filters, are paginated, use Kuala Lumpur date boundaries, and mask all identity values.

## AT-020 - Dashboard uses real data [P0]

Given a known seeded dataset, when the Admin changes the dashboard date range, then totals/charts recompute to the expected query results; average duration excludes active/no-show visits and no value is hard-coded.

## AT-021 - PDF/XLSX exports [P0]

Given report filters, when an Admin exports PDF and XLSX, then both files open, reflect the same filters and records, display masked identities, exclude blacklist/session/token data, and create audit logs. Spreadsheet values beginning with formula characters are rendered inert.

## AT-022 - Blacklist administration [P0]

Given an Admin, when they create, edit, deactivate, and review a blacklist entry, then effective dates and match policy are enforced, restricted reason is not visible to Guard/Teacher, and every mutation is audited. A non-Admin direct request is denied.

## AT-023 - User deactivation and session revocation [P0]

Given an active staff session, when an Admin deactivates that account or resets its password, then its existing sessions become unusable and new login is rejected until appropriately reactivated. The system prevents an Admin from accidentally removing the last active Admin without an explicit safe policy.

## AT-024 - Audit safety [P0]

Given the critical workflows, when the Admin reads audit entries, then actor/action/target/time and safe metadata are present, but password, raw session/public/QR token, full identity, encryption key material, and IC image data are absent. No audit edit/delete action exists.

## AT-025 - Email delivery and failure [P0]

Given Mailpit is healthy, when a required event occurs, then the expected safe email is delivered. Given SMTP is unavailable, the business transaction still completes when safe, notification becomes `FAILED` or retryable, no secret appears in the UI, and Admin can inspect/retry delivery.

## AT-026 - Localization and dark mode [P0]

Given a Guard, when Bahasa Melayu and dark mode are selected, then all main guard navigation, scan states, walk-in/check-in/out actions, validations, and emergency labels use the selected supported copy and remain legible; the preference survives navigation/reload.

## AT-027 - Sensitive identity handling [P0]

Given a stored identity, then ordinary lists, Teacher pages, Guard pages, email, badge, exports, URLs, and logs show no full value. Only an Admin can perform explicit reveal, and the reveal action itself is audited. Database fields contain ciphertext/HMAC/last4, not a plain identity value.

## AT-028 - Clean setup [P0]

Given a clean machine with documented prerequisites, when the README setup sequence is followed, then containers become healthy, migrations apply, seed succeeds, app starts, demo accounts log in, and Mailpit displays emails without external credentials.

## AT-029 - Quality gates [P0]

Given the final repository, when lint, typecheck, unit/integration tests, Playwright critical suite, and production build run, then all finish successfully with no skipped critical scenario or ignored TypeScript error.

## AT-030 - OCR is honest and ephemeral [P1]

Given OCR is implemented, when a visitor/Guard selects an IC image, then extraction happens in browser memory, fields remain editable and require confirmation, the UI states OCR does not verify identity, and network/database inspection shows the image was never uploaded or stored.

## Minimum automated coverage map

### Unit

- status-transition matrix and idempotency
- timezone/date-window calculations
- identifier normalization, validation, masking, HMAC, encryption round trip, wrong-key failure
- token generation/hash/expiry/revocation
- blacklist decision matrix
- spreadsheet formula escaping
- role permission matrix

### Integration

- public request transaction and outbox
- approval/rejection transaction
- check-in/check-out transaction
- walk-in clear/blocked transaction
- user deactivation/session revocation
- report query/filter consistency

### Playwright critical path

1. Visitor submits -> Teacher approves -> Visitor pass opens -> Guard checks in -> badge renders -> emergency list includes -> Guard checks out -> emergency list excludes.
2. Teacher rejects -> visitor sees rejection -> pass cannot check in.
3. Guard walk-in -> blacklist clear and blocked branches.
4. Admin filters -> exports -> audit record appears.
5. Cross-role route and mutation denial.
