# SMKBBSP VisitorPass - Project Specification

Status: build-ready baseline  
Audience: student developer, supervisor, coding agent, tester  
Academic title: **Smart Visitor Management System with QR Code and Appointment-Based Access Control for Secondary Schools**

## 1. Product summary

SMKBBSP VisitorPass is a responsive web application that replaces the paper visitor logbook at SMK Bandar Baru Sri Petaling. A visitor can request an appointment with a teacher without creating an account. The teacher approves or rejects the request. On submission the visitor is given a private link on screen; once the teacher approves, that same link becomes an expiring QR pass. The system sends no email to anyone: visitors follow their request through the private link, and staff are notified inside the application. At the gate, a guard scans the pass, visually checks the visitor's physical identification where required, and checks the visitor in. Nothing is printed for the visitor: the pass is digital. The guard checks the visitor out when the visit ends. Walk-ins use a shorter guard-assisted workflow.

Administrators manage staff, destinations, visitor records, blacklist entries, reports, and audit logs. During an emergency, authorized users can instantly see and print the current on-site visitor list.

The system is "smart" because it coordinates approval, access state, expiry, blacklist rules, overdue visits, notifications, and auditability. It does not claim biometric or government identity verification.

## 2. Problem statement

The current paper process is slow, exposes previous visitors' personal details, is difficult to search, allows incomplete or false entries, and does not provide teachers with an approval step or guards with a reliable list of expected visitors. Records may be damaged or lost, and an emergency headcount requires manual checking.

## 3. Objectives

1. Digitize visitor pre-registration, gate registration, check-in, check-out, and record search in a secure database-backed system.
2. Introduce appointment-based access control through teacher approval and expiring QR visitor passes.
3. Improve daily gate operations with fast tablet workflows, digital passes, blacklist checks, in-app staff notifications, emergency lists, analytics, exports, and audit trails.

## 4. Success measures

- A trained guard can process an approved QR arrival in under 30 seconds, excluding a visitor's physical-ID discussion.
- A teacher can approve or reject a request in three interactions or fewer after opening its detail page.
- Every checked-in visitor appears on the emergency list within one page refresh.
- Search and dashboard requests complete within 3 seconds for 10,000 seeded visit records on the reference local environment.
- No QR payload contains personal information.
- No sensitive identity value appears unmasked in ordinary lists, exports, logs, URLs, or notifications.
- All P0 acceptance scenarios pass.

## 5. Users and permissions

### 5.1 Visitor - no account

- Submit an appointment request.
- Provide consent to stated data use.
- Receive a private status/pass link on screen at submission, and keep it (bookmark, copy, or screenshot). Nothing is sent to the visitor afterwards.
- Learn the teacher's decision by reopening that link.
- View only their own request status and approved QR pass.
- Cancel a pending or approved future request through the private link.
- Correct a pending request only before teacher action, if implemented safely.

### 5.2 Teacher - authenticated

- View only requests assigned to them.
- Approve or reject a pending request with an optional note.
- View upcoming, active, and historical visits for which they are the host.
- See an in-app notification when a new request arrives and when their visitor checks in.
- Cannot view full identity numbers or other teachers' queues.

### 5.3 Security guard - authenticated

- View today's approved/expected, checked-in, overdue, and recently completed visits.
- Scan a QR code or enter its short fallback code.
- See a masked visitor summary and blacklist result.
- Confirm physical ID was sighted, where policy requires it.
- Check in, deny, or check out a visitor.
- Register and check in a walk-in.
- Show a walk-in visitor their pass on screen for them to scan.
- View and print the current emergency visitor list.
- Cannot manage users, change blacklist records, or browse arbitrary sensitive exports.

### 5.4 Administrator - authenticated

- All oversight functions, but not impersonation.
- Manage users, teacher profiles, destinations, visit types, and school settings.
- Search visitor and visit history with filters.
- Create, update, deactivate, and review blacklist entries.
- View dashboard analytics and operational alerts.
- Export filtered reports to PDF and XLSX.
- View audit logs.
- Reveal a full identity number only through an explicit, audited action when authorized by school policy.

## 6. Scope priorities

### P0 - required for FYP demo

1. Credentials login, logout, sessions, and role-based access control.
2. Public visitor pre-registration and private request-status link.
3. Teacher approval/rejection.
4. Expiring QR pass and manual fallback code.
5. Guard today screen and QR/manual lookup.
6. Check-in/check-out state machine.
7. Guard-assisted walk-in registration.
8. Digital pass for walk-ins, shown on the guard's screen for the visitor to scan.
9. In-app notifications for staff. Visitors follow their request through the private link. No email is sent.
10. Visitor/visit history and search.
11. Blacklist management and blocking checks.
12. Emergency on-site visitor list.
13. Administrator dashboard with real analytics.
14. PDF and XLSX report exports.
15. User/destination management, audit logging, seed data, and automated tests.
16. English/Bahasa Melayu guard workflow and dark mode.

### P1 - implement after every P0 test passes

1. OCR assistance for Malaysian IC fields with mandatory user correction/confirmation and immediate image disposal. Reading runs on a self-hosted vision model the application server calls; the photograph is held for one request and never stored, and the feature is absent where no model host is configured. The model host is a separate machine from the application server, reached over a private network (Tailscale) rather than the public internet, and its unavailability is a supported state in which the form is typed in.
2. Revoke/reissue QR pass. A reissued link is shown once to the administrator, who hands it to the visitor.
3. Configurable visit windows, badge prefix, data-retention interval, and overdue threshold.
4. No-show batch action for past approved visits.

### Out of scope

MyDigitalID, government data access, identity authenticity claims, biometrics, face recognition, fingerprint/iris scanning, ML anomaly detection, chatbot, plate recognition, geofencing, location tracking, native mobile apps, access-control turnstiles, payment, email/SMTP delivery, SMS/WhatsApp, and production deployment.

## 7. Core workflows and rules

### 7.1 Appointment request

1. Visitor opens `/visit/request`.
2. Visitor selects host teacher, visit date/time, visit type, destination if allowed, and purpose.
3. Visitor enters name, phone, identity type, identity number, party size, optional email, and optional vehicle number. Email is kept for records and blacklist matching only; nothing is ever sent to it.
4. System validates the visit is in the future, within configured school hours, and the teacher/destination is active.
5. System normalizes identity and contact values, checks active blacklist match rules, records consent, and creates `PENDING` request.
6. If there is a definite identity blacklist match, create the request as `REVIEW_REQUIRED`, do not notify it as a normal approval, and alert administrators. Do not reveal blacklist details publicly.
7. Otherwise notify the teacher in-app.
8. After submission the visitor is sent straight to their private request page at `/v/[token]`. That page shows the reference number and tells the visitor to save the link. It is the only place the raw token appears: no other URL, log, notification, or audit record contains it.
9. A lost link cannot be recovered, because there is no email to resend and no public lookup (a lookup would reveal who has visited). The visitor submits a new request or is registered as a walk-in.

Appointment status transitions:

- `PENDING -> APPROVED`
- `PENDING -> REJECTED`
- `PENDING -> CANCELLED`
- `PENDING -> EXPIRED`
- `PENDING -> REVIEW_REQUIRED` when a block is found after creation
- `REVIEW_REQUIRED -> PENDING | REJECTED` by an administrator
- `APPROVED -> CANCELLED | EXPIRED`

Transitions are server-enforced and audited. Repeating the same action must not create duplicate QR credentials or notifications.

### 7.2 Teacher decision

1. Teacher opens their pending queue.
2. Detail shows visitor name, masked identity, date/time, purpose, type, party size, and destination. It does not show a full identity number.
3. Teacher approves or rejects. Rejection requires a visitor-safe reason; approval may include instructions.
4. Approval transaction changes status, creates one `EXPECTED` visit, binds an expiring QR credential to the appointment's current private status/pass token hash, and writes an audit log. The private token is not rotated on approval: the link the visitor saved at submission becomes their pass.
5. QR validity begins 30 minutes before scheduled start and ends at the configured visit end plus 30 minutes. An admin can revoke and reissue it.
6. The private status page shows appointment details, school instructions, QR, fallback code, and expiry. The visitor learns of approval or rejection by reopening it.

### 7.3 Approved visitor at gate

1. Guard opens `/guard/scan` and scans the QR or types the fallback code.
2. Server hashes the submitted token/code and looks up an active credential.
3. Result handles: valid and expected, too early, expired, revoked, rejected/cancelled, already checked in, already checked out, or not found.
4. A valid result shows a masked visitor summary, host, purpose, destination, party size, appointment window, and blacklist status.
5. Guard confirms physical ID sighting when visit policy requires it. This is a human confirmation, not a claim that the system authenticated the ID.
6. Check-in transaction rechecks status/blacklist/validity, changes visit to `CHECKED_IN`, records time and guard, marks credential use, creates a badge number, notifies the host in-app, and writes audit/event records.
7. Repeat scans return the active visit state and check-out option without duplicating the visit.

### 7.4 Walk-in

1. Guard selects walk-in and enters the same minimum visitor fields, host, destination, purpose, expected duration, and ID-sighted confirmation.
2. Server performs blacklist checks before check-in.
3. If blocked, check-in is denied and the guard receives a neutral instruction to contact an administrator. Details remain admin-only.
4. If allowed, the transaction creates an appointment/source record marked `WALK_IN`, creates a `CHECKED_IN` visit, badge, notifications, and audit records.
5. Walk-in never requires a visitor email. The guard's screen is the delivery channel: it shows a QR of the visitor's pass link, which the visitor scans with their own phone. The raw token is returned once and never redirected to, logged or stored.

### 7.5 Check-out

1. Guard can scan the badge QR, use the active visitor list, or search by badge/reference/name.
2. Only `CHECKED_IN` visits can be checked out.
3. Transaction records checkout time and guard, changes status to `CHECKED_OUT`, closes the on-site presence, notifies the host in-app if enabled, and writes audit/event records.
4. Repeat checkout is idempotent and displays the original checkout state.

Visit status transitions:

- `EXPECTED -> CHECKED_IN | DENIED | CANCELLED | NO_SHOW`
- `CHECKED_IN -> CHECKED_OUT`
- `CHECKED_IN` becomes operationally `OVERDUE` when the expected end has passed, but the persisted lifecycle status remains `CHECKED_IN`; overdue is a derived flag.

### 7.6 Blacklist

- Exact identity HMAC is the strongest match and blocks approval/check-in.
- Phone/email matches create `REVIEW_REQUIRED` unless an administrator explicitly marks the entry as a hard block.
- Name-only matching is never an automatic block.
- Guard sees `CLEAR`, `REVIEW`, or `BLOCKED`, not the reason details.
- Admin records category, safe internal reason, effective period, status, creator, reviewer, and evidence reference if available.
- Every create/update/deactivate/reveal action is audited.

### 7.7 Emergency list

- Query all visits with status `CHECKED_IN` and no checkout.
- Show generated time, total people including party sizes, visitor name, badge, host, destination, check-in time, expected end, and overdue flag.
- Provide high-contrast screen mode and print-friendly A4 output.
- Exclude full identity and detailed purpose from the printed emergency list.

## 8. Functional requirements

| ID | Priority | Requirement |
|---|---:|---|
| FR-001 | P0 | Authenticate staff and enforce Admin, Guard, and Teacher permissions server-side. |
| FR-002 | P0 | Let a visitor submit an appointment request without an account. |
| FR-003 | P0 | Give each visitor a private, expiring status link, shown on screen at submission, containing no PII in its URL. |
| FR-004 | P0 | Let the assigned teacher approve or reject a pending request. |
| FR-005 | P0 | Generate an opaque expiring QR pass and short manual fallback code on approval. |
| FR-006 | P0 | Notify staff in-app of new requests, requests needing review, arrivals, cancellations, and (optionally) check-outs. No email is sent to anyone. |
| FR-007 | P0 | Let guards scan or enter a pass and receive a clear validity result. |
| FR-008 | P0 | Check in a valid expected visitor once, recording guard, time, and ID-sighting declaration. |
| FR-009 | P0 | Register and check in a walk-in after validation and blacklist checks. |
| FR-010 | P0 | Check out an active visitor once, recording guard and time. |
| FR-011 | P0 | Issue a walk-in a digital pass on registration and display it for the visitor to scan. |
| FR-012 | P0 | Search/filter visitor and visit history with masked sensitive data. |
| FR-013 | P0 | Manage blacklist entries and enforce block/review rules. |
| FR-014 | P0 | Display and print the live emergency on-site list. |
| FR-015 | P0 | Calculate dashboard totals, trends, visit types, peak hours, approval rates, and average duration from stored data. |
| FR-016 | P0 | Export the applied report filters to PDF and XLSX and audit the export. |
| FR-017 | P0 | Manage staff accounts, teachers, destinations, visit types, and selected settings. |
| FR-018 | P0 | Record append-oriented audit logs for privileged and lifecycle actions. |
| FR-019 | P0 | Support English and Bahasa Melayu on main guard pages and support dark mode. |
| FR-020 | P0 | Derive overdue visitors and upcoming/expired/no-show operational alerts using explicit rules. |
| FR-021 | P1 | Assist form entry with OCR on a self-hosted vision model and discard the source image immediately. The image is never written to disk and no extracted value is persisted before the visitor submits the form. |
| FR-022 | P1 | Show a public school map that routes a visitor on foot from a chosen starting point to any room across the four levels, drawing the path and stating it as written turn-by-turn directions in English and Bahasa Melayu. Routing is computed server-side from map data held in the database; no map data or personal data reaches a third party. |

## 9. Information architecture

### Public

- `/` - concise product/home page with visitor request and staff login actions.
- `/visit/request` - appointment request form.
- `/v/[token]` - private visitor status, cancellation, and QR pass page. The request form redirects here on success.
- `/login` - staff login.

### Teacher

- `/teacher` - pending count, today's visits, recent decisions.
- `/teacher/requests` - own queue with filters.
- `/teacher/requests/[id]` - decision detail.
- `/teacher/visits` - own upcoming/active/history.

### Guard

- `/guard` - "Today at the Gate" operational home.
- `/guard/scan` - camera scanner and manual code input.
- `/guard/visits/[id]` - arrival/check-in/check-out detail.
- `/guard/walk-in` - tablet-optimized registration.
- `/guard/active` - current on-site list.
- `/guard/emergency` - emergency mode and print view.

### Administrator

- `/admin` - analytics dashboard.
- `/admin/appointments` - all requests.
- `/admin/visits` and `/admin/visits/[id]` - history/detail.
- `/admin/blacklist` and `/admin/blacklist/[id]` - management/review.
- `/admin/reports` - filters, PDF, XLSX.
- `/admin/users` - staff accounts and roles.
- `/admin/destinations` - destinations and visit types.
- `/admin/audit` - audit log.
- `/notifications` - in-app notifications for the signed-in staff member.
- `/admin/settings` - school name, hours, QR windows, overdue and retention values.

Unauthorized route access returns a safe forbidden page or redirects to the user's correct home. It must never briefly render protected content.

## 10. Data model

Use UUID/CUID-style non-sequential public identifiers. Internal database IDs must never act as authentication tokens.

### User

- `id`, `email` unique normalized, `name`, `passwordHash`, `role`, `isActive`
- `preferredLocale`, `lastLoginAt`, `passwordChangedAt`, timestamps

### Session

- `id`, `userId`, `tokenHash` unique, `expiresAt`, `revokedAt`, timestamps
- optional safe metadata: truncated user-agent label and IP prefix; avoid unnecessary tracking

### TeacherProfile

- `id`, `userId` unique, `staffCode`, `department`, `phone`, `isAcceptingVisits`

### Destination

- `id`, `nameEn`, `nameMs`, `code` unique, `instructionsEn`, `instructionsMs`, `isActive`

### VisitType

- `id`, `nameEn`, `nameMs`, `requiresIdSighted`, `defaultDurationMinutes`, `isActive`

### Visitor

- `id`, `fullName`, optional normalized `email` (records and matching only), normalized `phone`, `visitorCategory`
- `identityType`: `NRIC | PASSPORT | DRIVING_LICENCE | OTHER`
- `identityCiphertext`, `identityIv`, `identityTag`, `identityKeyVersion`, `identityHmac`, `identityLast4`
- `consentVersion`, `consentedAt`, timestamps
- no stored IC image and no address unless a later approved requirement proves it necessary

### Appointment

- `id`, human-friendly unique `referenceNumber`, `source`: `ONLINE | WALK_IN`
- `visitorId`, `teacherId`, `destinationId`, `visitTypeId`
- `scheduledStart`, `scheduledEnd`, `purpose`, `partySize`, optional `vehicleNumber`
- `status`, `decisionNote`, `decidedAt`, `decidedById`, `cancelledAt`
- `publicTokenHash`, `publicTokenExpiresAt`, timestamps

### Visit

- `id`, `appointmentId` unique where present, `visitorId`, `teacherId`, `destinationId`
- `status`, `badgeNumber` unique, `expectedStart`, `expectedEnd`
- `checkedInAt`, `checkedInById`, `checkedOutAt`, `checkedOutById`
- `idSightedAt`, `idSightedById`, `denialCode`, safe `guardNote`, timestamps

### QrCredential

- `id`, `appointmentId`, `tokenHash` unique, `fallbackCodeHash` unique
- `validFrom`, `expiresAt`, `firstUsedAt`, `revokedAt`, `revokedById`, timestamps
- only one active credential per approved appointment
- `tokenHash` may match the appointment private-link token hash. The visitor page receives the raw token from its own URL and renders that opaque pass URL as the QR; the database never needs the raw token. Approval binds to the existing token and does not rotate it. Reissuing a pass rotates both the private link and credential hash; because nothing can be sent, the new link is shown once to the administrator who performs the reissue.

### BlacklistEntry

- `id`, `status`: `ACTIVE | INACTIVE | EXPIRED`
- optional `identityHmac`, normalized phone/email match values, display name
- `matchPolicy`: `BLOCK | REVIEW`
- `category`, encrypted or access-restricted `reason`, `validFrom`, `validUntil`
- `createdById`, `reviewedById`, timestamps

### Notification

- `id`, `type`, `channel`, `userId` (the staff member it belongs to), `link`, `readAt`
- safe JSON `payload` (title and body), `status`, `sentAt`, timestamps
- every new notification is `IN_APP`, written already `SENT` because there is no delivery step. The `EMAIL` channel and delivery-attempt columns remain only so rows written before email was removed stay readable.
- payload must exclude raw identity values and raw QR tokens

### VisitEvent

- `id`, `visitId`, `type`, `actorUserId`, safe JSON `metadata`, `createdAt`

### AuditLog

- `id`, `actorUserId`, `action`, `targetType`, `targetId`, safe JSON `metadata`, `createdAt`
- append-oriented application behavior; no edit/delete UI

### Setting

- typed settings for school identity, operating hours, timezone, QR grace windows, overdue threshold, badge prefix, consent version, and data-retention days

Add indexes for appointment status/date/teacher, visit status/check-in/date/teacher, visitor identity HMAC/phone/email, QR hashes, blacklist active match fields, audit time/action/actor, and notification status.


### School map

`MapLevel` is one storey of the school. `MapNode` is a point in the walkable
graph; a node that also carries a width and height is a drawn room, and a node
of kind `STAIR` exists at the same coordinates on every level it serves.
`MapEdge` joins two nodes with a weight in metres - derived from the
coordinates for a walk, fixed for a stair.

`Destination.mapNodeId` binds a bookable destination to the room it means. The
binding is optional and is cleared rather than cascaded if a room is removed:
an unbound destination stops being routable and keeps working everywhere else.

Plan coordinates are not survey data. They are transcribed from the school's
own floor plans, room widths are proportional rather than measured, and every
distance the interface shows is rounded to five metres to avoid implying a
precision the source does not have.
## 11. Security and privacy design

### Identity data

- Normalize Malaysian NRIC by removing spaces/hyphens and validate 12 digits. Do not infer gender, birth date, state, ethnicity, or citizenship from the number.
- Normalize passport/other identifiers conservatively to uppercase and safe characters.
- Use an environment-held HMAC-SHA-256 key for deterministic matching.
- Use AES-256-GCM with a random 96-bit IV for reversible storage. Keep key version with the record to allow future rotation.
- Mask as `******-**-1234` or equivalent; full reveal is admin-only, explicit, and audited.

### Tokens

- Generate at least 256 bits of cryptographically secure randomness for public/QR tokens.
- Generate an 8-character non-ambiguous fallback code with rate-limited lookup.
- Store only token hashes. Send the raw token only in its intended link/QR.
- The same high-entropy private status/pass token may be used for both `/v/[token]` access and the approved QR credential. Before approval it reveals only request status; after approval its scan is accepted only within the separate credential validity window.
- Never include name, NRIC, email, phone, appointment ID, or role in a QR payload.

### Application security

- Hash passwords with a reputable slow password algorithm supported reliably by the runtime. Configure a safe work factor and document it.
- Use generic login and public-token error messages.
- Apply CSRF protection appropriate to the chosen Next.js mutation pattern and verify Origin on sensitive state changes.
- Set secure headers: CSP appropriate to app dependencies, frame protection, nosniff, referrer policy, and strict transport security in production.
- Prevent mass assignment by constructing database writes from validated fields.
- Escape spreadsheet cells beginning with `=`, `+`, `-`, or `@` to prevent formula injection.
- Sanitize filenames and never accept arbitrary filesystem paths.
- Rate-limit sensitive public endpoints.
- Provide `.env.example`; never commit `.env` or real keys.

### PDPA-minded behavior

- Show a concise purpose/consent notice before submission.
- Collect no address and no stored IC photo in the baseline.
- Mask identifiers in tables, badges, emergency lists, notifications, and routine exports.
- Include a documented retention job/command and admin preview; destructive purge execution may be a P1 administrative task.
- Use fictional data only in seeds, tests, screenshots, and reports.

## 12. Notifications

The system sends no email. Staff are notified in-app; visitors have no account and learn everything from their private link.

Write each in-app notification in the same transaction as the business change that causes it, so a rolled-back change cannot leave a notification behind. There is no delivery step, so nothing can fail or need retrying after commit.

Required in-app notifications:

1. Teacher: new request awaiting their decision, linking to the request.
2. Administrators: a request needs review, with no blacklist reason in the text.
3. Host teacher: their visitor has arrived (approved visit or walk-in).
4. Host teacher: a visitor cancelled an approved or pending request.
5. Host teacher, if enabled in settings: their visitor has checked out.

What visitors see on their private page instead of emails: that the request was received, the decision (with the visitor-safe rejection reason or approval instructions), the QR pass once approved, and cancellation.

Notification text contains a reference number, never identity data or a raw token.

## 13. Reports and analytics

All values derive from database queries and obey the selected date range.

Dashboard metrics:

- today's expected, pending, checked-in, checked-out, overdue, and denied counts
- visitors by day/week/month
- approval/rejection/no-show rates
- visit type distribution
- busiest arrival hours
- top destinations by visit count
- average visit duration using completed visits only

Report filters:

- date range, appointment/visit status, teacher, destination, visit type, source, and visitor category

Export columns:

- reference, visitor name, masked identity, category, host, destination, type, source, scheduled window, actual in/out, duration, lifecycle status

Do not export full identity values, blacklist reasons, session data, or audit metadata in ordinary visit exports.

## 14. Badge and QR presentation

Badge includes:

- school/product name
- `VISITOR` label and badge number
- visitor full name
- host teacher and destination
- visit date and expected end
- a badge QR for visit lookup/check-out using an opaque token or the approved visit credential
- short instruction: return/scan at exit

Badge excludes identity number, phone, email, detailed purpose, and blacklist state. Provide browser print CSS and an A4 layout that can print one or multiple badges without navigation.

## 15. Localization and accessibility

- Main guard workflow has English and Bahasa Melayu strings; do not machine-translate at runtime.
- Dates display in Malaysian format with clear month text where ambiguity matters.
- Buttons and form controls on guard pages have at least 44 by 44 CSS pixel targets.
- Meet WCAG AA contrast for text and controls.
- Support keyboard operation, screen-reader labels, visible focus, reduced motion, and form errors linked to fields.
- Camera denial must expose manual code entry immediately.

## 16. Local environment and seed

Docker Compose services:

- PostgreSQL 16 with healthcheck and named volume.

Application `.env.example` includes:

- `DATABASE_URL`
- `APP_URL`
- session/identity encryption/HMAC secrets
- timezone and demo seed password values where safe

Seed users:

- `admin@smkbbsp.test`
- `guard@smkbbsp.test`
- `teacher@smkbbsp.test`

Use one documented local demo password or explicit per-role passwords. Require change before any non-demo deployment.

Seed at least five teachers and destinations plus enough visits across 60-90 days for meaningful charts. All identities and contact details must be obviously fictional and reserved domains must be used.

## 17. Non-functional requirements

- Reliability: status-changing operations are transactional and idempotent.
- Performance: indexed queries and pagination; never load all history into a client component.
- Usability: core guard scan/check-in can be completed on a 10-inch Android tablet over 4G.
- Compatibility: current Chrome, Edge, Firefox, and Safari; scanner needs a secure context except localhost.
- Maintainability: strict TypeScript, domain services, schema migrations, fixtures, tests, and clear documentation.
- Auditability: all security-relevant actions have safe immutable-style audit entries.
- Recoverability: database backup/restore instructions exist; local volumes are not presented as backups.
- Connectivity: baseline is online-first. Offline check-in is explicitly out of scope; show a clear connection error instead of pretending a write succeeded.

## 18. Definition of done

The repository is complete only when:

- all P0 features exist and match the workflows above
- clean migration and seed succeed
- role permissions are covered by tests
- P0 acceptance tests pass
- lint, typecheck, unit/integration tests, critical E2E tests, and production build pass
- developer README contains setup, architecture, demo script, credentials, privacy notes, backup/restore, and limitations
- no excluded technology is present in UI or implementation claims
- no real school stakeholder or student personal data is included
