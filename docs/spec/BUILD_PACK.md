# SMKBBSP Visitor Management System - Claude Code Build Pack

This folder is a complete instruction pack for building a realistic undergraduate Final Year Project in one Claude Code session.

## Recommended academic title

**Smart Visitor Management System with QR Code and Appointment-Based Access Control for Secondary Schools**

Working product name: **SMKBBSP VisitorPass**.

## What changed from the initial report

The revised system removes dependencies and research claims that are difficult to deliver or validate in one semester:

- No MyDigitalID integration or mock MyDigitalID flow.
- No face recognition, fingerprint, iris scanning, or other biometrics.
- No machine-learning anomaly detection.
- No geofencing requirement.
- No campus route tracking.
- No paid SMS dependency.

The project instead demonstrates a complete operational workflow: appointment requests, teacher approval, QR passes, guard check-in/check-out, walk-in registration, badges, blacklist checks, in-app staff notifications, searchable history, emergency lists, reports, exports, privacy controls, and audit logs. Optional Malaysian IC OCR is included only as assisted data entry. It does not claim to authenticate identity.

## Files in this pack

- `ONE_SHOT_CLAUDE_CODE_PROMPT.md` - paste this once into Claude Code.
- `CLAUDE.md` - persistent Claude Code repository instructions.
- `AGENTS.md` - agent-compatible engineering contract.
- `PROJECT_SPEC.md` - authoritative product and technical specification.
- `IMPLEMENTATION_PLAN.md` - build order and completion checklist.
- `ACCEPTANCE_TESTS.md` - concrete end-to-end acceptance scenarios.
- `FYP_SCOPE_REVISION.md` - report-facing explanation of the revised scope.

## How to use it

1. Create an empty project folder.
2. Copy every file from this pack into that folder, preserving the filenames.
3. Open a terminal in the folder and start Claude Code with `claude`.
4. Paste the complete contents of `ONE_SHOT_CLAUDE_CODE_PROMPT.md` as the first message.
5. Let Claude continue through implementation and verification. Approve normal package installation and local Docker commands when prompted.
6. At the end, follow the commands and demo credentials reported by Claude.

Use Node.js 22 LTS and Docker Desktop if possible. The specification uses a local PostgreSQL container and sends no email, so the project can be demonstrated without paid cloud accounts, a mail server, or external service credentials.

## Expected result

Claude should leave a runnable repository with source code, database migrations, seed data, tests, screenshots or test evidence, an `.env.example`, Docker support, and a developer README. It must not stop after generating a plan or UI mockup.

## Important academic note

The student's Chapter 1-3 report must be revised to match the implemented system. Do not continue claiming MyDigitalID verification, machine-learning anomaly detection, geofencing, or live route tracking if they are not part of the build.
