# Demonstration walkthrough

A rehearsable script for showing SMKBBSP VisitorPass to a supervisor or examiner.
Roughly 12 minutes at a comfortable pace.

The README has a shorter demo summary; this is the full presenter's version, with
the things that commonly go wrong called out in advance.

---

## Before you start

### 1. Start the infrastructure

```bash
wsl -e bash -c "cd /mnt/c/Users/iyasoooo/Desktop/SMKBBSP-VMS && docker compose up -d"
```

Wait until both containers report `healthy`:

```bash
wsl -e bash -c "cd /mnt/c/Users/iyasoooo/Desktop/SMKBBSP-VMS && docker compose ps"
```

> On this machine Docker Desktop provides **no `docker.exe` on Windows**, so
> `npm run db:up` fails from PowerShell. Drive compose through WSL as above.

### 2. Refresh the demonstration data

Do this **on the morning of the demo**. The seed anchors its data to the current
date, so re-seeding gives you today's arrivals and live passes.

```bash
npm run db:seed
```

### 3. Start the application

```bash
$env:NEXT_TELEMETRY_DISABLED=1; npm run dev
```

> The environment variable is **required** on this machine. Without it Next.js
> crashes at startup with `EXDEV: cross-device link not permitted`.

### 4. Open the tabs you will need

| Tab | URL |
|---|---|
| Public site | <http://localhost:3000> |
| Mailpit inbox | <http://localhost:8025> |

### 5. Print your cue card

```bash
npx tsx scripts/demo-facts.ts
```

This prints the real reference numbers, badge numbers, manual pass codes, and the
blacklisted identity number from your seeded database. Keep it beside you.

**If you are rehearsing outside school hours (07:30–17:00)**, every seeded pass
will already have expired and the guard scan step cannot be shown. Mint a pass
that is valid right now:

```bash
npx tsx scripts/demo-live-pass.ts
```

It prints a pass URL and a manual code you can use immediately.

---

## Accounts

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@smkbbsp.test` | `Admin#Demo2025` |
| Guard | `guard@smkbbsp.test` | `Guard#Demo2025` |
| Teacher | `teacher@smkbbsp.test` | `Teacher#Demo2025` |

Local demonstration credentials only.

---

## The script

### Act 1 — A visitor requests a visit (2 min)

1. Open <http://localhost:3000>. Point out the three-step explanation and the
   privacy notice: **the QR authorises an appointment, it does not verify identity.**
2. Select **Request a visit**. Fill the form as a parent.
   - Choose a date **1–3 days ahead**, time **10:00**.
   - Say out loud that the teacher list only shows staff currently accepting
     visits — one seeded teacher is on leave and is deliberately absent.
3. Tick the consent box and submit.
4. The success page shows **a reference number only**. Say why: the private token
   never appears in a URL, so it cannot leak through browser history or a
   shared screen.
5. Switch to **Mailpit**. Two emails arrived: the visitor acknowledgement and the
   teacher notification. Open the visitor one and point out that the **subject
   carries only the reference number** — no name, no purpose.
6. Follow the private link in the email. The status reads **Awaiting approval**.

**If asked "what if I lose the email?"** — go to `/visit/status`. It deliberately
offers no lookup form: a public search by name or reference would let anyone
confirm whether a person had arranged to visit the school.

### Act 2 — The teacher decides (2 min)

1. Sign in as the **teacher**. The dashboard shows the pending count.
2. Open **Requests**. Only this teacher's queue is visible.
3. Open the request you just created. Note the identity number is shown
   **masked** (`******-**-5523`) — teachers never see the full value.
4. **Approve** it with a short note.
5. Back to Mailpit: the approval email has arrived with the QR pass, the manual
   fallback code, and the validity window.
6. Open the visitor's private link again — it is now a **QR visitor pass**.

**Worth saying:** approving is one database transaction — status, exactly one
expected visit, exactly one active credential, the emails and the audit entry all
commit together, or none of them do. Pressing approve twice cannot create two
badges.

### Act 3 — Arrival at the gate (4 min)

Resize the window to a tablet width first, or open on a tablet — the guard
interface is designed for a 10-inch screen.

1. Sign in as the **guard**. The "Today at the Gate" screen shows expected,
   on-site, overdue and recently completed visits.
2. Toggle **Bahasa Melayu**, then **dark mode**. Both persist across navigation.
3. Open **Scan**.
   - If a camera is available, scan the QR from the visitor's pass page.
   - Otherwise, demonstrate the **camera-denied fallback**: the manual code entry
     is immediately usable. Type the code from your cue card.
4. The result shows a masked visitor summary, host, destination, party size,
   window, and a blacklist state of **CLEAR**. Point out the guard sees only
   `CLEAR`, `REVIEW` or `BLOCKED` — never a reason.
5. Tick **physical ID sighted** and check the visitor in.
   - Say precisely what this means: the system records *the guard's declaration*
     that identification was sighted. It makes no claim the card is genuine.
6. **Print the badge**. Show that navigation disappears and it fits A4. The badge
   carries name, badge number, host, destination and QR — **no identity number,
   no phone, no purpose**.
7. Scan the same pass again. It returns the existing active visit and a check-out
   option — **no duplicate visit, badge or email**.

### Act 4 — Walk-in and the blocked path (2 min)

1. Choose **Walk-in**. Register a visitor with no appointment. Note email is
   optional — a walk-in may not have one.
2. Submit and check in. A badge is issued.
3. Now the important one: start another walk-in, using the **blacklisted identity
   number from your cue card**.
4. Check-in is refused with a neutral **"contact an administrator"** message.
   - Emphasise: the guard is told nothing about *why*. The reason, the category
     and the entry itself are administrator-only. The attempt is still audited.

### Act 5 — Emergency list (1 min)

1. Open **Emergency**. It lists everyone currently on site with a **total people
   count** that includes party sizes, not just a row count.
2. Point out the overdue visitor is clearly flagged.
3. Show the print view: high contrast, A4, and **no identity numbers or purposes**
   — it is carried outside during an evacuation.
4. Check your visitor out, refresh, and show they have disappeared from the list.

### Act 6 — Administration (3 min)

Sign in as the **administrator**.

1. **Dashboard** — every figure is a database query over the selected range.
   Change the date range and watch the totals and charts recompute. Note that
   average duration uses completed visits only, so active and no-show visits
   cannot distort it.
2. **Visits** — filter by date, host, destination, type, source and status.
   Identity values are masked throughout.
3. Open a visit and show the **timeline** built from visit events.
4. **Reveal identity** — this is the only place a full number can be seen. Do it,
   then immediately open **Audit** and show the reveal was recorded, with actor,
   action, target and time.
5. **Reports** — apply filters and export **PDF** and **XLSX**. Open both. Show
   the filter summary and page numbers in the PDF, and that identities are masked
   in both. Show the export appears in the audit log.
6. **Blacklist** — show the three seeded entries and the block/review distinction.
7. **Users** — deactivate a staff account and explain that this revokes their
   existing sessions immediately; the system also refuses to remove the last
   active administrator.
8. **Audit** — filters, and no edit or delete controls anywhere.

### Act 7 — Access control (1 min)

The most convincing 60 seconds of the whole demo.

1. Still signed in as the guard (or teacher), type an admin URL directly:
   `http://localhost:3000/admin/users`
2. You are redirected to your own home. **No protected content is rendered, not
   even for a moment.**
3. Say why: authorization is enforced in the server and data layer before any
   protected data is fetched. Hiding a navigation link is not access control.

---

## Questions you should be ready for

**"Does the QR verify who the visitor is?"**
No. It authorises an approved appointment. Identity assurance comes from the
guard sighting physical identification, which the system records as a
declaration — not as proof.

**"Is the data encrypted?"**
Identity numbers are encrypted at rest with AES-256-GCM, and separately keyed
with HMAC-SHA-256 for blacklist matching. Do not claim the whole database is
encrypted — that depends on deployment controls this project does not provide.

**"Is it PDPA compliant?"**
Say it applies privacy-minded controls aligned with data minimisation and access
control — masking, encryption, consent capture, audit logging, retention
settings. Compliance is a legal assessment, not something the code can assert.

**"Why not MyDigitalID / AI anomaly detection?"**
Feasibility review. MyDigitalID needs authorised developer access that is not
available, and a local mock would only test the mock. Anomaly detection cannot be
validated without representative historical data and a defensible ground truth.
`docs/spec/FYP_SCOPE_REVISION.md` documents the reasoning.

**"What happens if the email server is down?"**
The business transaction still commits. Notifications are written to an outbox in
the same transaction and delivered afterwards; a failure marks the row `FAILED`
and an administrator can inspect and retry it. An SMTP outage cannot roll back a
check-in.

**"Can it work offline?"**
No, and that is deliberate. Offline check-in is out of scope. The app shows a
clear connection error rather than pretending a write succeeded.

---

## Known limitations to volunteer

Being upfront about these reads far better than being caught by them.

- Optional IC OCR (P1) is not implemented.
- Rate limiting is a fixed window in the database — correct for one instance,
  would need shared storage to scale out.
- There is no manual pass revoke/reissue button; revocation happens
  automatically on rejection, cancellation and re-approval.
- No in-app notification centre; email only.
- Two dependency advisories remain in transitive packages inside Next.js's and
  exceljs's own trees, with no non-breaking upgrade available.
