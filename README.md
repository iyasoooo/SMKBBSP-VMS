# SMKBBSP VisitorPass

**Smart Visitor Management System with QR Code and Appointment-Based Access Control for Secondary Schools**

A web application that replaces the paper visitor logbook at SMK Bandar Baru Sri Petaling. A visitor
requests an appointment without creating an account and is given a private link on screen; the host
teacher approves or rejects it, and on approval that same link becomes an expiring QR pass. At the
gate a guard scans the pass, records that physical identification was sighted, checks the visitor in,
and checks them in. The visitor's pass is digital; nothing is printed for them.

> **No email.** The system sends nothing to anyone and needs no mail server. Visitors follow their
> request through the private link they are shown when they submit; staff are notified in-app.

> **What this system does not claim.** The QR pass authorises an *approved appointment*. It does not
> verify who the holder is — that is why the guard also inspects physical identification and records
> that they did so. There is no MyDigitalID integration, no biometrics, no machine-learning anomaly
> detection, no plate recognition and no location tracking. See `docs/spec/FYP_SCOPE_REVISION.md`.

> **Working on this with an AI assistant?** Point it at [`docs/llms.txt`](docs/llms.txt) first. It is a
> compact map of the architecture, the invariants that must not be broken, and the traps that have
> already cost someone a debugging session.

---

## Contents

- [Requirements](#requirements)
- [Setup](#setup)
- [Demo accounts](#demo-accounts)
- [Commands](#commands)
- [Demo script](#demo-script)
- [Architecture](#architecture)
- [Security and privacy](#security-and-privacy)
- [Testing](#testing)
- [Backup and restore](#backup-and-restore)
- [Known limitations](#known-limitations)

---

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 LTS or newer | Developed and verified on Node 24. |
| npm | 10 or newer | Ships with Node. |
| PostgreSQL | 16 | Via Docker, or the bundled no-Docker fallback below. |
| Docker Desktop | current | Optional — see [option B](#option-b--without-docker). |

---

## Setup

### 1. Install dependencies and create your environment file

```bash
npm install
```

```bash
cp .env.example .env
```

On Windows PowerShell use `Copy-Item .env.example .env`.

Then generate the three secrets and paste them into `.env`, replacing each `CHANGE_ME` value:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Run it three times — `SESSION_SECRET`, `IDENTITY_ENCRYPTION_KEY` and `IDENTITY_HMAC_KEY` must all
differ. The app refuses to start if any is missing, the wrong length, or reused.

### 2. Start PostgreSQL

#### Option A — with Docker (recommended)

```bash
npm run db:up
```

Starts PostgreSQL 16 on `localhost:5432`.

**Running the whole system in containers.** `docker compose` also builds and runs the application
itself, which is the simplest way to operate it beyond development:

```bash
docker compose up -d --build
```

That starts PostgreSQL, waits for it to report healthy, runs `prisma migrate deploy`
to completion, and only then starts the app on <http://localhost:3000>. Load the demonstration data
once with:

```bash
docker compose run --rm app npm run db:seed
```

Secrets are read from `.env` at run time and are never baked into the image — compose refuses to
start if `SESSION_SECRET`, `IDENTITY_ENCRYPTION_KEY` or `IDENTITY_HMAC_KEY` are missing. Steps 3 and
4 below are only needed when running the app outside a container.

> **Windows + WSL2 installs.** Some Docker Desktop installations provision the CLI *only* inside WSL
> and leave no `docker.exe` on Windows, which makes `npm run db:up` fail from PowerShell even though
> the engine is running. Check with `wsl -e docker version` — if it prints a `Server:` block, drive
> compose through WSL instead:
>
> ```bash
> wsl -e bash -c "cd /mnt/c/Users/$USER/Desktop/SMKBBSP-VMS && docker compose up -d"
> ```
>
> Note that `docker compose version` is *not* a valid check: it reports the plugin binary's version
> without ever contacting the daemon. If `docker version` shows no `Server:` block, enable
> **Settings → Resources → WSL Integration** for your distro and Apply & Restart.

#### Option B — without Docker

If Docker is unavailable, an npm-only substitute provides the same port and credentials, so nothing
in `.env` changes. Run it in its own terminal and leave it running:

```bash
npm run local:pg
```

`local:pg` runs a real PostgreSQL 16 server from the `embedded-postgres` package, storing data in
`.local/pgdata`.

### 3. Apply migrations and load the demonstration data

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

### 4. Start the application

```bash
npm run dev
```

Open <http://localhost:3000>.

---

## Demo accounts

**Local development only.** These passwords live in `.env.example` and must never be used anywhere
real. Change them before any deployment.

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@smkbbsp.test` | `Admin#Demo2025` |
| Security guard | `guard@smkbbsp.test` | `Guard#Demo2025` |
| Teacher | `teacher@smkbbsp.test` | `Teacher#Demo2025` |

The seed also creates a second guard and five more teachers. Every name, contact detail and identity
number is invented; email addresses use the reserved `.test` domain, which cannot resolve on the
public internet.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the development server. |
| `npm run build` | Production build. |
| `npm run start` | Serve the production build. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | TypeScript, strict, no emit. |
| `npm test` | Unit and integration tests (Vitest). |
| `npm run test:e2e` | Prepare the E2E database, then run Playwright. |
| `npm run db:migrate` | Create and apply a migration. |
| `npm run db:seed` | Load demonstration data (clears operational tables first). |
| `npm run db:reset` | Drop, re-migrate and re-seed. |
| `npm run db:studio` | Prisma Studio. |
| `npm run db:up` / `db:down` | Start/stop the Docker services. |
| `npm run local:pg` | No-Docker PostgreSQL. |

---

## Demo script

A ten-minute walkthrough that exercises every P0 feature.

1. **Visitor submits a request.** Open <http://localhost:3000>, choose **Request a visit**, and
   complete the form, picking **Puan Aminah binti Zulkifli** as the host. Email is optional — leave it
   blank. On submit you land on the visitor's private page, which says plainly to save the link:
   nothing will be sent. **Copy that address**; it is the visitor's only way back.
2. **Teacher is notified in-app.** Sign in as the teacher and open **Notifications** — the new
   request is there. Nothing was emailed to anyone.
3. **Teacher approves.** The pending request is also on the overview. Open it — the identity number
   is masked — and approve with a note. Approval creates exactly one expected visit and one active
   pass, bound to the link the visitor already has.
4. **Visitor reopens the same link.** Paste the address from step 1. The page that said "Awaiting
   approval" now shows the QR, the 8-character fallback code, the teacher's note, and the validity
   window.
5. **Guard processes arrivals.** Sign in as the guard. **Today at the gate** lists expected arrivals,
   visitors on site, and overdue visitors. Use **Scan pass** — the camera scanner is there, and the
   manual code box works without it. Try language **MS** and dark mode; both persist across reloads.
6. **Walk-in.** Choose **Walk-in**, register a visitor, tick the ID declaration, and submit. The
   the guard is shown the visitor's pass QR to hand over on screen.
7. **Blocked walk-in.** Repeat with name `Rizal bin Sulaiman`, phone `+60121119999`, identity
   `779912319001`. Check-in is refused with a neutral "contact an administrator" message. The guard
   is told nothing about why; the attempt is recorded in the audit log.
8. **Emergency list.** Open **Emergency list**. It shows everyone on site and totals *people*, not
   rows, so a party of three counts as three. Print preview shows a clean A4 sheet.
9. **Check out.** From **On site**, open a visitor and check them out. They disappear from the
   emergency list.
10. **Administrator.** Sign in as the admin. The dashboard recomputes from the selected date range —
    set it to 2019 and every figure drops to zero. Visit **Reports**, apply filters, and export both
    PDF and Excel. Then open **Audit log** and find the export recorded.
11. **Audited identity reveal.** Open any appointment, choose **Request full value**, and give a
    reason. The full number appears and the reveal is written to the audit log.

---

## Architecture

Single Next.js App Router codebase, TypeScript strict throughout.

```text
app/            routes; server components read, server actions mutate
  login/        credentials sign-in
  visit/        public request form, status help
  v/[token]/    private visitor status and QR pass
  teacher/      own queue and own visit history only
  guard/        today, scan, walk-in, active, emergency
  admin/        dashboard, history, blacklist, users, reports, audit, settings
components/     presentational UI, no business logic
lib/
  auth/         sessions and server-side authorization
  crypto/       identity encryption/HMAC, password hashing, token generation
  domain/       business services (appointments, decisions, gate, blacklist, admin, in-app notifications)
  reports/      shared report query, PDF and XLSX writers
  i18n/         guard dictionary (English / Bahasa Melayu)
  validation/   Zod schemas for every mutation boundary
prisma/         schema, migrations, deterministic seed
tests/          unit, integration (real PostgreSQL), e2e (Playwright)
```

**Decisions worth knowing:**

- **Domain services own the rules.** React components never contain a state transition. Approval,
  check-in, check-out and walk-in are transactional and idempotent, so a double tap or a retried
  request cannot create a second visit, badge or notification.
- **No email, by design.** The system sends nothing and depends on no mail server. Staff notifications
  are in-app rows written inside the same transaction as the change that caused them, so a
  rolled-back approval cannot leave a notice behind — and there is no delivery step that could fail.
- **One link, shown once.** Submission redirects the visitor to `/v/<token>`, the only place the raw
  token ever appears. Approval binds the pass to that same token rather than rotating it, so the link
  the visitor saved becomes their pass. Only an administrator's reissue rotates it, and the new link is
  handed back to that administrator to give to the visitor.
- **UTC in, Kuala Lumpur out.** Every instant is stored in UTC; every date boundary, report range and
  "today" is evaluated against the Malaysian calendar day.
- **Authorization lives in the data layer.** A teacher's queries carry `teacherId` in the `where`
  clause, so a valid session still cannot reach another teacher's request by guessing an id.
- **Masking at the boundary.** Screens render a `SafeVisitor` view model that has no ciphertext and
  no full-identity field, so a new page cannot leak one by accident.
- **A blocked check-in commits before it throws.** Marking the visit denied and writing its audit
  entry must survive; raising the error inside the transaction would roll both back.

---

## Security and privacy

- **Identity numbers.** Normalised server-side, then stored three ways: AES-256-GCM ciphertext (with
  its IV, auth tag and key version), a keyed HMAC-SHA-256 for blacklist matching and deduplication,
  and the last four characters. No column can hold a plaintext NRIC. A plain SHA-256 would be
  reversible by brute force, because a 12-digit NRIC has a small enough keyspace to enumerate.
- **Passwords.** scrypt (RFC 7914) from Node's core crypto: N=32768, r=8, p=1, 64-byte key, random
  16-byte salt. Parameters travel with each hash so they can be raised later without invalidating
  existing passwords.
- **Tokens.** 256 bits of CSPRNG output. Only hashes are stored; session tokens use a keyed HMAC so a
  leaked database alone does not allow offline verification. QR payloads contain nothing but an
  opaque pass URL.
- **Sessions.** Database-backed and individually revocable. Cookies are `httpOnly`, `sameSite=lax`,
  path `/`, and `secure` in production. Deactivating an account or resetting a password revokes every
  live session immediately.
- **Blacklist.** Identity, phone and email are matched; a name alone never matches automatically,
  because common Malaysian naming patterns would deny entry to the wrong person. Guards see only
  `CLEAR` / `REVIEW` / `BLOCKED` — never the reason.
- **Audit.** Append-only, with metadata scrubbed before it is written: passwords, tokens, full
  identity values, key material and blacklist reasons are redacted by the sanitiser rather than by
  reviewer discipline. No edit or delete path exists.
- **Exports.** Identity values are masked. Cells beginning with `=`, `+`, `-`, `@`, tab or carriage
  return are prefixed with an apostrophe, because a visitor's free-text name would otherwise execute
  as a formula for whoever opens the file.
- **Rate limiting.** Login, public submission, token lookup and manual pass codes are all limited.
- **Headers.** CSP, frame protection, nosniff, referrer policy, a restrictive permissions policy, and
  HSTS in production.

---

## Testing

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

**Unit and integration** run under Vitest. Integration tests use a real PostgreSQL database
(`visitorpass_test`, derived automatically from `DATABASE_URL`) because the behaviour under test *is*
transactional: rollback, uniqueness and idempotency cannot be demonstrated against a mock.

**End-to-end** runs under Playwright against its own database (`visitorpass_e2e`) on port 3100, so a
run never disturbs your demonstration data. `npm run test:e2e` creates, migrates and seeds it first.
Two projects run: a desktop viewport, and a 10-inch Android tablet for the guard screens.

Coverage includes the status-transition matrix and idempotency, timezone and date-window
calculations, identifier normalisation/masking/HMAC/encryption round trips, token lifecycle, the
blacklist decision matrix, spreadsheet formula escaping, and the role permission matrix.

---

## Backup and restore

The Docker named volume is **not** a backup — removing the container stack can discard it. Take real
dumps:

```bash
docker compose exec -T postgres pg_dump -U visitorpass -Fc visitorpass > backup.dump
```

Restore into an empty database:

```bash
docker compose exec -T postgres pg_restore -U visitorpass -d visitorpass --clean --if-exists < backup.dump
```

A dump contains encrypted identity values but **not** the keys. A restore is useless — and the data
unreadable — without the matching `IDENTITY_ENCRYPTION_KEY` and `IDENTITY_HMAC_KEY`. Back the secrets
up separately, and never alongside the dump.

---

## Known limitations

Documented deliberately; none blocks the P0 feature set.

1. **Rate limiting is single-instance.** Counters are database-backed fixed windows, which suffices
   for one school deployment. Multiple instances would want shared atomic counters and a sliding
   window.
2. **Online-first.** Offline check-in is out of scope. A connection failure shows a clear error
   rather than pretending a write succeeded.
3. **Retention is preview-only.** The retention period is configurable and surfaced, but destructive
   purging is not automated.
4. **No email means no reminders and no lost-link recovery.** Visitors are never notified of a
   decision; they must reopen their link to see it. A visitor who loses their link before approval
   cannot get it back — there is nothing to resend, and a public lookup would reveal who has visited —
   so they resubmit or are registered as a walk-in. Once approved, an administrator can reissue the pass
   and hand the new link over in person. This is the deliberate cost of needing no mail server and no
   visitor contact details to deliver a pass.
5. **Same-day online bookings are impossible by design.** Requests need 60 minutes' notice
   (configurable) and passes open 30 minutes before the start, so a visitor needing immediate entry
   is handled as a walk-in. The end-to-end test reflects this: it asserts the correct refusal for a
   not-yet-valid pass, then exercises the gate lifecycle through a walk-in.
6. **OCR (P1) needs a model host, and is absent without one.** Card reading calls a self-hosted
   vision model (Qwen3.5 0.8B through Ollama) from the application server. In production the model
   runs on the same VPS, as an internal service of the Compose stack with no published port, so the
   photograph never leaves the server or crosses the public internet. The honest costs are size and
   speed: the server needs 8 GB of memory rather than 2 GB, and the model runs on CPU, so a read is
   slow and shares the processor with the gate. Where `OCR_OLLAMA_URL` is unset the scan panel does
   not appear; where the model is down or not yet downloaded it reports itself unavailable. Either
   way the form is typed in. The photograph is held for one request and
   never stored, but it does leave the browser, and no interface text claims otherwise. Because a
   language model reports no calibrated confidence, any value that is not structurally possible as
   a MyKad number is discarded rather than shown; doubt is inferred from structure, never from the
   model's own account of itself. It remains assisted data entry, not identity verification.
7. **Dependency advisories.** `npm audit` reports transitive issues inside Next.js's own tree
   (`postcss`, `sharp`) and `exceljs`'s pinned `uuid`. No non-breaking upstream fix is available, and
   none is reachable from a code path this application exposes.

---

## Project documents

The original build-pack specification is preserved alongside the code:

- `docs/spec/PROJECT_SPEC.md` — product and technical contract
- `docs/spec/ACCEPTANCE_TESTS.md` — the executable definition of done
- `docs/spec/IMPLEMENTATION_PLAN.md` — build order and checklist
- `docs/spec/FYP_SCOPE_REVISION.md` — scope boundaries and honest claims
- `docs/BUILD_PACK.md` — the original pack README

---

## Academic note

The report chapters must match what is implemented here. Do not claim MyDigitalID verification,
machine-learning anomaly detection, geofencing or route tracking. Accurate phrasing: the QR
represents an approved appointment; the guard records that physical identification was sighted;
deterministic rules flag overdue, expired and blacklisted conditions; and the design applies
privacy-minded controls aligned with data-minimisation and access-control principles.
