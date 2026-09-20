# FYP Scope Revision

This document converts the initial "SMKBBSP Secure Visitor Management System with AI Anomaly Detection" proposal into a deliverable and academically defensible undergraduate project.

## Recommended title

**Smart Visitor Management System with QR Code and Appointment-Based Access Control for Secondary Schools**

School-specific alternative:

**SMKBBSP Smart Visitor Management System with QR Code and Appointment-Based Access Control**

The word "smart" refers to workflow automation, validation rules, approvals, notifications, expiry, and reporting. It does not imply machine learning.

## Why the scope should change

The initial report combines MyDigitalID SSO, Keycloak, OAuth/OIDC, geofencing, interactive routing, three unsupervised ML models, OCR, voice alerts, Twilio, encryption, analytics, and multiple user interfaces. That is several separate projects, and some claims depend on access to services or datasets the student does not have.

MyDigitalID cannot be presented as a live identity-verification method without authorized developer access and a test environment. A local mock would test only the student's mock, not MyDigitalID. Likewise, anomaly detection cannot be validated credibly without sufficient representative historical visitor data and a defensible ground truth. Comparing three algorithms may produce charts, but it does not prove that the system identifies dangerous visitors.

The revised scope preserves the actual school problems found in the report: slow registration, exposed paper records, poor searchability, weak gate coordination, visitors wandering without a confirmed host, difficulty recognizing repeat/overdue visits, and no live emergency list.

## Replacement project concept

Visitors pre-register online and choose a teacher, time, destination, and purpose. The teacher approves or rejects the request. Approval creates an expiring QR visitor pass. At the gate, the guard scans the QR, visually checks the visitor's physical identification when required, and checks the visitor in. Walk-ins are registered by the guard and shown their own digital pass. Check-out closes the visit. Administrators manage records, blacklist entries, users, destinations, analytics, audit logs, emergency lists, and PDF/XLSX reports.

The system does not claim to prove that a physical identification card is genuine. It records the guard's declaration that identification was sighted. Optional OCR can reduce typing, but the extracted data must be reviewed and corrected by a human.

## Revised abstract draft

SMKBBSP currently records visitors using a paper logbook at the school gate. This process is slow during busy periods, exposes previously written personal information, is difficult to search, and does not provide a structured method for host approval or emergency visitor accounting. This project proposes a web-based Smart Visitor Management System with QR Code and Appointment-Based Access Control for SMK Bandar Baru Sri Petaling. Visitors submit an appointment request by selecting a host teacher, visit time, destination, and purpose. On submission the visitor receives a private link on screen; when the teacher approves the request, that link becomes an expiring QR pass. The system sends no email, so it needs no external mail service. At the gate, a security guard scans the pass, records physical identification sighting where required, and checks the visitor in. Walk-in visitors are issued the same kind of digital pass, shown on the guard's screen for them to scan; nothing is printed for a visitor. The system also supports guard-assisted walk-in registration, check-out, blacklist checks, host notifications, searchable visitor history, an emergency on-site list, dashboard analytics, audit logs, and PDF/Excel reports. Role-based access control separates visitor, teacher, guard, and administrator functions, while sensitive identity values are masked and protected. Optional optical character recognition may assist data entry from a Malaysian identity card, but the visitor or guard must confirm the extracted details and the feature does not claim to authenticate identity. The system is developed and evaluated through functional, usability, security, and performance testing using realistic school gate workflows.

## Revised problem statements

### 1. Inefficient and privacy-sensitive paper registration

Manual writing takes approximately 1.5 to 2 minutes per visitor according to the initial interview and can contribute to gate queues. Previous visitors' details remain visible in an open logbook, while retrieving an old record requires manual page-by-page searching.

### 2. No structured host approval or reliable gate authorization

The paper process does not let a teacher approve a visit before arrival. Guards may not know which visitors are expected that day, and self-entered details alone do not provide a controlled authorization workflow.

### 3. Limited real-time visibility and accountability

The school lacks a live list of visitors currently on site, consistent check-out records, automatic overdue indicators, blacklist checks, searchable reports, and an audit trail of staff actions. This reduces operational awareness during normal gate work and emergencies.

## Revised objectives

### Objective 1

To design and develop a secure web-based visitor record system that supports online pre-registration, guard-assisted walk-in registration, check-in, check-out, search, and privacy-aware storage.

### Objective 2

To implement appointment-based access control in which a host teacher approves or rejects a visit and an approved visitor receives an expiring QR code for gate processing.

### Objective 3

To evaluate whether the system improves school gate operations through digital visitor passes, in-app staff notifications, blacklist checks, emergency on-site reporting, analytics, exports, and role-based audit logs.

The evaluation should measure task completion, correctness, usability, response time, and access-control behavior. Do not claim that a QR code authenticates a person's identity; it authorizes an approved appointment and is combined with the guard's physical-ID sighting process.

## Revised scope

### Actors

- Visitor without an account
- Teacher
- Security Guard
- Administrator

### Core modules

1. Public appointment request
2. Teacher approval and rejection
3. QR pass generation and expiry
4. Guard QR/manual-code lookup
5. Walk-in registration
6. Check-in and check-out
7. Digital visitor pass for walk-ins
8. In-app staff notifications
9. Visitor history and search
10. Blacklist management
11. Emergency on-site list
12. Dashboard analytics
13. PDF and Excel exports
14. User, destination, and visit-type management
15. Audit logging

### Optional module

OCR for assisted Malaysian IC data entry. The image is not retained, the extracted data is editable, and a human confirms the result.

Reading was originally browser-side. It moved to a self-hosted vision model (Qwen3.5 0.8B via Ollama) called by the application server, because a browser-sized text recognizer transcribes lines without knowing which line is the name, and a real laminated MyKad defeats that inference often enough to make the feature useless. The trade is deliberate and is recorded here rather than hidden:

| | Browser-side recognizer | Self-hosted vision model |
| --- | --- | --- |
| Photograph leaves the device | No | Yes, to a machine the school controls |
| Confidence signal | Per-character, calibrated | None; structural validation only |
| Accuracy on real cards | Poor | Good |
| Runs on a 1 vCPU host | Yes | No; needs a separate model host |

Two consequences follow. The claim "the image never leaves your device" is no longer made anywhere in the interface. And because a language model produces fluent output whether or not it read correctly, any value that is not *structurally possible* as a MyKad number is discarded rather than shown - the system has no calibrated confidence to report and does not pretend to.

This remains assisted data entry. It is not identity verification, it does not check any registry, and it cannot detect a forgery.

#### Where the model runs

The vision model does not run on the application server. A small VPS of the size this project deploys to cannot hold one, and a server that could would cost more than the rest of the hosting combined. Instead a laptop at the school runs Ollama, and the application server reaches it over a Tailscale private network. The photograph travels inside a WireGuard tunnel between two machines the school controls; it does not cross the public internet and it does not reach a third party.

This is a deliberate architecture rather than a temporary measure, and it should be described that way in the report. Its honest cost is availability: card reading works when the laptop is awake and on the network, and not otherwise. The system is built so that this degrades rather than breaks - the scan panel reports itself unavailable and the form is typed in, exactly as it could always be - but a reviewer is entitled to note that a feature depending on a laptop being switched on is weaker than one that does not depend on anything.

A second property is worth stating because it cuts the other way. Ollama has no authentication: anything able to reach its port can use the model. The private network is therefore not a convenience but the entire access control, which is why the port is never published, forwarded, or bound to a public interface.

#### A failure mode specific to language models

A conventional recognizer that cannot read a digit produces something visibly wrong, and a person notices. A language model produces something *plausible*, and a person may not.

This is not hypothetical here. During testing, an unreadable image caused the model to return the example values written into its own prompt - a correctly formatted identity number and a placeholder name - and that reply passed structural validation cleanly, because a well-formed fabrication is structurally indistinguishable from a well-formed reading. Structural validation catches values that *could not* be real. It cannot catch a value that could be real but was invented.

Two safeguards follow, and the report should claim only what they actually deliver. The extracted values are always presented for a human to confirm and correct before anything is submitted, so a fabricated reading has to survive a person looking at the card in their hand. And no confidence figure is displayed, because the only available source for one would be the model's opinion of itself, which reads convincingly and means nothing.

The correct claim is therefore narrow: card reading reduces typing, under human confirmation, and its output is treated as an untrusted suggestion at every point. It is not a measurement, and its accuracy is not characterised in this project.

### Explicit exclusions

- MyDigitalID and Keycloak
- face/fingerprint/iris recognition
- AI/ML anomaly detection
- geofencing and campus route tracking
- license-plate recognition
- chatbots
- paid SMS/WhatsApp integrations

## Functional requirement replacement map

| Initial proposal element | Revised element | Reason |
|---|---|---|
| MyDigitalID identity verification | Teacher-approved appointment plus guard physical-ID sighting | Achievable without unavailable government API; claims remain honest. |
| Mock MyDigitalID mode | Removed | A mock cannot demonstrate real identity verification. |
| Three ML anomaly models | Deterministic overdue, expired, repeat-state, and blacklist rules | Explainable and testable with limited FYP data. |
| Geofencing | Guard-operated QR check-in at the physical gate | Guard action already establishes operational gate presence. |
| Campus live routing | Destination and host shown on the digital pass | Lower complexity and easier to maintain. |
| Twilio SMS | No outbound messages at all: in-app notifications for staff, and a private link shown on screen for visitors | No paid account, no mail server, and no visitor contact detail needed to deliver a pass. |
| Web Speech anomaly alert | High-contrast operational alert and overdue list | Accessible, predictable, and testable. |
| Plain SHA-256 of NRIC | Keyed HMAC for matching plus AES-GCM encryption where retrieval is required | Plain hashes of predictable identifiers are vulnerable to guessing. |
| OCR as fallback verification | Optional OCR-assisted form filling | OCR reads text; it does not verify authenticity. |

## Suggested research/evaluation questions

1. Does QR-based appointment processing reduce the median time required for an approved visitor to check in compared with the current paper process?
2. Can users in Teacher, Guard, and Administrator roles complete their assigned tasks without accessing functions or data outside their roles?
3. Does the emergency visitor list accurately reflect all checked-in visitors and party sizes after check-in and check-out events?
4. How do guards and teachers rate the usability of the appointment approval and gate-processing workflows?

## Suggested evaluation plan

- Functional testing against the acceptance scenarios in `ACCEPTANCE_TESTS.md`.
- Role-based authorization tests for every protected page and mutation.
- Timed usability tasks with representative users: submit request, approve, scan/check in, walk-in, check out, emergency list, and report search.
- Performance test with at least 10,000 fictional visit records for dashboard/search targets.
- Security/privacy inspection covering masked identity display, QR payload content, session behavior, audit logs, and export fields.
- Comparison of median gate task time with the reported 1.5 to 2 minute paper baseline, while documenting sample size and test conditions.

## Report sections that must be rewritten

The title, abstract, introduction, project background, all three problem statements, objectives, scope, literature review technology sections, comparison table, requirements tables, use-case model, flowcharts, software/hardware requirements, conclusion, questionnaire interpretations, and interview implications must match the revised system.

Survey responses about willingness to use MyDigitalID, geofencing, campus routing, or AI may be reported as results of the original requirements exercise, but they must not be used to claim that unavailable or removed features were implemented. Explain that feasibility review and supervisor/client prioritization caused the scope revision.

## Claims to avoid during presentation

- "The QR verifies the visitor's identity."
- "The system is connected to MyDigitalID."
- "OCR detects fake IC cards."
- "The system uses AI to detect dangerous visitors."
- "The database is PDPA compliant" without a formal legal/compliance assessment.
- "AES-256 encrypts the entire database" unless the actual deployment provides and verifies that control.

Use narrower, testable wording: the QR represents an approved appointment; the guard records that physical identification was sighted; OCR assists typing; rules flag operational conditions; and the design applies privacy-minded controls aligned with data-minimization and access-control principles.
