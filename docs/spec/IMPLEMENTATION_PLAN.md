# Implementation Plan

Claude Code must treat this as an execution checklist, not a proposal. Work in order unless an existing repository makes a different dependency order safer. Check an item only after code and relevant verification exist.

## Target repository shape

```text
app/
  (public)/
  (auth)/
  teacher/
  guard/
  admin/
  api/
components/
  ui/
  public/
  teacher/
  guard/
  admin/
lib/
  auth/
  db/
  domain/
  crypto/
  qr/
  reports/
  i18n/
  validation/
prisma/
  schema.prisma
  migrations/
  seed.ts
tests/
  unit/
  integration/
  e2e/
public/
docs/
```

Equivalent organization is acceptable if boundaries remain clear. Domain services must not depend on React components.

## Phase 0 - Protect the specification and inspect the environment

- [x] Read every root specification file completely.
- [x] Inspect existing files, package manager, git status, Node version, and Docker availability.
- [x] Record safe assumptions in the developer README instead of asking routine questions.
- [x] Preserve the build-pack documents in the final repository.
- [x] Establish a task list and keep it current throughout the session.

Exit check: repository state and required toolchain are understood; no code has been deleted without reason.

## Phase 1 - Application and local infrastructure

- [x] Initialize Next.js App Router with TypeScript strict, Tailwind, ESLint, and npm in the current directory.
- [x] Add `docker-compose.yml` for PostgreSQL 16 and Mailpit with healthchecks.
- [x] Add `.env.example`, safe `.gitignore`, environment validation, and documented secret generation.
- [x] Configure Prisma current GA, PostgreSQL connection, migrations, and seed entry point.
- [x] Add script contract from `CLAUDE.md` plus `db:up`, `db:down`, and `db:studio` if useful.
- [x] Establish application shell, typography, restrained school theme, error boundary, not-found page, toast/feedback pattern, and responsive navigation.
- [x] Add secure baseline headers and timezone utilities.

Exit check: database and Mailpit become healthy; app boots; lint, typecheck, and a smoke test pass.

## Phase 2 - Schema, crypto, authentication, and authorization

- [x] Implement the complete baseline schema and indexes from `PROJECT_SPEC.md`.
- [x] Create initial migration and verify it applies to an empty database.
- [x] Implement normalized identifiers, masking, HMAC matching, AES-256-GCM encryption/decryption, key version, and unit tests.
- [x] Implement password hashing, database-backed sessions, secure cookies, login, logout, expiry, revocation, and inactive-user rejection.
- [x] Implement server-side route/mutation authorization helpers for `ADMIN`, `GUARD`, and `TEACHER`.
- [x] Add origin/CSRF controls appropriate to the selected mutation pattern.
- [x] Add rate limiting for login and public token endpoints.
- [x] Create safe audit service and structured safe logging.
- [x] Seed the three demo roles, five teachers, destinations, visit types, and settings.

Exit check: authentication works, cross-role access fails safely, crypto round trips, sensitive values are masked, and auth/crypto tests pass.

## Phase 3 - Public appointment vertical slice

- [x] Create public home and appointment request form with accessible validation.
- [x] Add teacher/destination/type availability queries.
- [x] Implement visitor upsert/deduplication rules without unsafe broad matching.
- [x] Implement consent capture and school-hours/future-date rules.
- [x] Implement blacklist block/review checks with neutral public responses.
- [x] Create appointment reference and private status token securely.
- [x] Implement safe success page and private `/v/[token]` status page.
- [x] Add notification outbox and request-received/new-request templates.
- [x] Deliver local email to Mailpit and support retry status.
- [x] Add public rate limiting and integration tests.

Exit check: a new request persists as `PENDING`, appears only to its assigned teacher/admin, and sends safe Mailpit emails.

## Phase 4 - Teacher decision and QR pass

- [x] Build teacher dashboard, own request queue, filters, detail, empty states, and pagination.
- [x] Implement approve/reject state transition service with transactions and idempotency.
- [x] Bind the QR credential to the current 256-bit private status/pass token, or rotate it safely during approval; generate a non-ambiguous fallback code and store only hashes.
- [x] Enforce validity window, expiry, revocation, and one active credential rule.
- [x] Generate QR image only at presentation/email time from the raw one-time credential context or secure pass link.
- [x] Update visitor private status page for approved/rejected/cancelled states.
- [x] Add decision/pass email templates and safe reasons/notes.
- [x] Add teacher history and authorization tests.

Exit check: approval creates exactly one expected visit and one active pass; rejection creates no usable pass; other teachers cannot access the request.

## Phase 5 - Guard gate operations

- [x] Build tablet-first guard home with expected, active, overdue, and recent sections.
- [x] Add English/Bahasa Melayu guard dictionary and persistent language toggle.
- [x] Add dark mode and high-contrast operational states.
- [x] Implement browser camera QR scanner with permission/error states and manual code fallback.
- [x] Implement pass lookup result states without leaking whether unrelated records exist.
- [x] Implement guard arrival detail with masked identity, host, destination, visit window, and ID-sighted confirmation.
- [x] Implement transactional/idempotent check-in with final blacklist and validity recheck.
- [x] Implement walk-in validation, optional email, blacklist handling, check-in, and audit.
- [x] Implement active visitor search and transactional/idempotent check-out.
- [x] Implement badge data, QR/check-out lookup, print CSS, and A4 print route.
- [x] Implement emergency on-site screen and A4 print view with party total.
- [x] Queue host arrival/checkout notifications.
- [x] Add operational alert rules for overdue, expiring expected visits, and unresolved review items.

Exit check: approved and walk-in scenarios complete end-to-end; repeated scans/actions do not duplicate events; emergency list updates correctly.

## Phase 6 - Administrator workflows

- [x] Build analytics dashboard with database-derived metrics and useful date range.
- [x] Build paginated appointment and visit history with all specified filters.
- [x] Build visit detail and safe timeline from `VisitEvent`/audit data.
- [x] Implement blacklist create/update/deactivate/review with match preview and restricted reason.
- [x] Implement explicit, audited full-identity reveal for admin only.
- [x] Implement staff/teacher management, activation/deactivation, password reset/session revoke, and self-lockout protections.
- [x] Implement destination, visit type, and selected settings management.
- [x] Build append-only audit viewer with filters and no mutation controls.
- [x] Build notification delivery viewer/retry for admins.

Exit check: all admin mutations are authorized, validated, audited, and reflected in live queries.

## Phase 7 - Reports and exports

- [x] Implement report query service shared by screen, PDF, and XLSX.
- [x] Ensure filters, timezone boundaries, pagination, and totals are consistent.
- [x] Generate polished PDF with school title, filter summary, generated time, page numbers, totals, and masked columns.
- [x] Generate XLSX with readable widths, header styling, typed dates, masked identity, and spreadsheet-formula injection protection.
- [x] Audit each export with safe filter metadata.
- [x] Test empty exports, large-enough seeded exports, and permission failures.

Exit check: files open correctly, match filters, contain no forbidden sensitive fields, and export actions appear in audit logs.

## Phase 8 - P1 only after P0 is green

- [ ] If time remains, add browser-side OCR behind a clearly optional action.
- [ ] Process the image only in browser memory; never upload or store it.
- [ ] Highlight uncertain extraction and require explicit review/edit confirmation.
- [ ] Display "OCR assists data entry and does not verify identity" in English and Bahasa Melayu.
- [ ] Add revocation/reissue UI, no-show batch action, and in-app notifications if they do not threaten P0 quality.

Exit check: P1 features are honest, isolated, tested, and removable without affecting core flows.

## Phase 9 - Seed, tests, polish, and handoff

- [x] Expand deterministic seed to 60-90 days of fictional visits and every important status.
- [x] Complete unit tests for transitions, permissions, crypto, token validity, dates, masking, blacklist, and export escaping.
- [x] Complete integration tests for each transactional service.
- [x] Complete Playwright P0 critical paths from `ACCEPTANCE_TESTS.md`.
- [x] Test responsive guard pages at a 10-inch-tablet viewport and admin pages at desktop width.
- [x] Test camera-denied manual fallback and print views.
- [x] Run a personal-data/log scan and remove accidental secrets or PII.
- [x] Write developer README: setup, commands, architecture, schema, demo script, accounts, Mailpit, testing, backup/restore, privacy, and limitations.
- [x] Apply migrations and seed from a clean database using documented commands.
- [x] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`; fix all failures.
- [x] Review navigation and remove dead, duplicate, or placeholder UI.
- [x] Review all copy and docs for excluded-technology claims.

Exit check: a fresh clone can be launched from documentation, every P0 check is green, and the final completion report is evidence-based.

## Phase 10 - Remove email delivery

Decision: the system sends no email to anyone. Visitors get their private link on screen at submission and follow the request there; staff are notified in-app. Earlier phases that mention Mailpit, SMTP, the outbox, or email templates describe what was built before this change.

- [ ] Redirect a successful submission to the visitor's private page, and make that page tell the visitor to save the link.
- [ ] Bind the approval credential to the existing private token instead of rotating it, so the saved link becomes the pass.
- [ ] Show a reissued pass link once to the administrator who reissued it.
- [ ] Replace every staff email with an in-app notification written in the same transaction.
- [ ] Make visitor email optional on the public form; keep it for records and blacklist matching only.
- [ ] Remove the outbox, email templates, SMTP configuration, mail scripts, delivery viewer, background sweep, and Mailpit service.
- [ ] Update seed, tests, README, HOSTING, and demo walkthrough.
- [ ] Run lint, typecheck, unit/integration tests, and build; verify the visitor flow in a browser.

Exit check: no code path opens an SMTP connection; a submitted request can be followed to check-in using only the link shown at submission.
