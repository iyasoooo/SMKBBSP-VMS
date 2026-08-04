# One-shot prompt for Claude Code

Copy everything below the divider and paste it as one message into Claude Code from the project root.

---

You are the lead engineer responsible for delivering the complete SMKBBSP VisitorPass Final Year Project in this repository. Work autonomously from start to finish in this single session. Do not stop after planning or scaffolding, and do not ask me to choose routine implementation details. The authoritative decisions are already documented.

Before writing code, read these files completely in this order:

1. `CLAUDE.md`
2. `AGENTS.md`
3. `PROJECT_SPEC.md`
4. `IMPLEMENTATION_PLAN.md`
5. `ACCEPTANCE_TESTS.md`
6. `FYP_SCOPE_REVISION.md`

Then inspect the repository. If it contains only specification files, initialize the application in the current directory without deleting or overwriting those files. If partial code already exists, assess it and continue from the safest compatible point.

## Mission

Build a polished, demo-ready, production-minded MVP named **SMKBBSP VisitorPass** for a Malaysian secondary school. It must implement appointment-based visitor pre-registration, teacher approval, QR visitor passes, walk-in registration, guard check-in and check-out, printable badges, email notifications, visitor history, dashboard analytics, blacklist management, an emergency on-site visitor list, PDF/Excel exports, role-based access control, privacy protections, and audit logging.

The system must be realistic for an undergraduate FYP and must run locally without MyDigitalID, biometric hardware, paid APIs, or machine-learning infrastructure.

## Hard scope boundaries

Never implement, simulate, advertise, or leave placeholders for:

- MyDigitalID, Keycloak, national identity SSO, or government API access.
- Face recognition, fingerprint, iris scanning, voice identification, or any biometric matching.
- Machine-learning anomaly detection, Isolation Forest, One-Class SVM, LOF, or fabricated AI scores.
- License-plate recognition, geofencing, or continuous visitor tracking.
- A chatbot.
- Twilio or any paid service required for the local demo.

Optional IC OCR is permitted only as assisted form filling using browser-side OCR. The guard or visitor must review and correct the extracted fields. The UI and documentation must state that OCR does not verify identity. Never retain the uploaded IC image after processing.

## Required technical baseline

- Next.js App Router with TypeScript in strict mode.
- Node.js 22 LTS compatible.
- Tailwind CSS with accessible, responsive components; avoid a generic dashboard-template appearance.
- PostgreSQL 16 and Prisma ORM (use the current generally available Prisma release, not an early-access or preview ORM).
- A database-backed credentials/session implementation with secure `httpOnly`, `sameSite=lax`, production-only `secure` cookies, password hashing, session expiry, and server-side role checks. Do not trust client-side role state.
- Zod validation at every mutation boundary.
- Docker Compose for PostgreSQL and Mailpit.
- Nodemailer-compatible SMTP delivery, with Mailpit as the local default.
- QR generation and camera scanning, with a manual token entry fallback for devices without camera permission.
- PDF badge/report generation and XLSX report export.
- Recharts or a similarly small chart library for useful analytics.
- Vitest for unit/integration tests and Playwright for critical end-to-end paths.
- ESLint, formatting, type-checking, and a production build.

Use stable packages supported by the selected framework. Pin normal semver ranges in `package.json` and commit the lockfile. Avoid preview APIs unless the framework itself requires them. Do not introduce a second backend, microservices, Redis, cloud storage, or a mobile app.

## Required execution behavior

1. Create and maintain a task list from `IMPLEMENTATION_PLAN.md`.
2. Build vertical slices: database and auth, appointments, approval and QR, gate operations, administration, reports, then hardening and tests.
3. After every major slice, run the closest relevant checks and fix failures immediately.
4. Use migrations and deterministic seed data. Do not replace persistence with in-memory mocks.
5. Implement real authorization, validation, error handling, empty states, loading states, and confirmation flows. No TODO-only routes, dead buttons, fake analytics, or hard-coded production data.
6. Preserve the specification documents. Mark completed items in `IMPLEMENTATION_PLAN.md` only after the corresponding code is verified.
7. Add a clear project `README.md`, `.env.example`, `docker-compose.yml`, seed command, migration commands, and demo accounts.
8. Make the local developer experience one-command where practical. Prefer `npm` commands consistently.
9. Do not deploy, push to a remote, or create external accounts. Local completion is the goal.
10. If a dependency or command fails, diagnose it, select a stable compatible alternative if necessary, update the documentation, and continue. Do not abandon the build because one package is troublesome.

## Product quality bar

The guard experience is the priority: a tablet-friendly "Today at the Gate" screen, large touch targets, high contrast, fast search, clear visit status, camera/manual QR entry, and obvious check-in/check-out actions. Bahasa Melayu and English labels must be available for the main guard workflow. Include dark mode.

The teacher experience must make pending approvals immediately clear and allow approve/reject with an optional note. The visitor flow must work without an account through a private token link. The administrator area must expose meaningful live metrics calculated from database data, not decorative placeholder numbers.

Use a restrained school-oriented visual language: deep navy, warm white, emerald success, amber warnings, red danger, clear typography, and minimal card clutter. Make focus states, labels, errors, tables, dialogs, and print layouts accessible.

## Security and privacy rules

- Collect only data defined in `PROJECT_SPEC.md`.
- Treat Malaysian NRIC/passport numbers as sensitive. Normalize them server-side. Store a keyed HMAC for equality/blacklist matching and an AES-256-GCM encrypted value only where retrieval is required. Never use plain SHA-256 as a password substitute or as the sole protection for predictable NRIC values.
- Mask identity numbers everywhere except the minimum authorized verification view.
- Never log passwords, session tokens, QR tokens, full identity numbers, or IC images.
- QR codes must contain an opaque random token, not personal data. Store only a hash of the token. Support expiry, revocation, and single-visit lifecycle rules.
- Audit privileged and security-relevant changes with actor, action, target, timestamp, and safe metadata.
- Apply rate limiting to login, public appointment submission, token lookup, and QR/manual code verification. A database-backed or process-safe local implementation is acceptable for the FYP, but document production scaling limitations.
- Use transactions for approval, check-in, check-out, and blacklist-sensitive transitions where consistency matters.

## Minimum seed/demo dataset

Create deterministic demo accounts and document their passwords in the developer README only as local-demo credentials:

- `admin@smkbbsp.test` - Administrator
- `guard@smkbbsp.test` - Security Guard
- `teacher@smkbbsp.test` - Teacher

Seed at least five teachers/destinations, approved and pending appointments, one checked-in visit, one completed visit, one expired/rejected request, one blacklist entry, and enough historical visits for charts and reports. Use obviously fictional Malaysian-format names and data.

## Definition of done

Do not report completion until all of the following are true:

- Every P0 feature and all acceptance scenarios marked P0 in `ACCEPTANCE_TESTS.md` are implemented.
- The database starts, migrations apply from a clean state, and seed data loads.
- `npm run lint`, `npm run typecheck`, `npm test`, the critical Playwright suite, and `npm run build` pass.
- No navigation item leads to an unfinished page and no required button is inert.
- A fresh user can follow the project README to run the system.
- The final repository contains no real credentials or personal data.
- You review the final diff for spec drift, security regressions, and accidental references to excluded technologies.

At the end, provide a concise completion report containing: implemented modules, key architecture decisions, commands run and their results, demo URLs and accounts, known non-blocking limitations, and the exact command sequence I should use to launch the demo. Continue working until you can honestly provide that report.
