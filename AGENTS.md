# Agent engineering contract

These instructions apply to any coding agent working in this repository.

## Objective

Deliver a complete, honest, demo-ready FYP implementation of SMKBBSP VisitorPass according to `docs/spec/PROJECT_SPEC.md` and `docs/spec/ACCEPTANCE_TESTS.md`.

## Required first actions

1. Read `CLAUDE.md`, `docs/spec/PROJECT_SPEC.md`, `docs/spec/IMPLEMENTATION_PLAN.md`, and `docs/spec/ACCEPTANCE_TESTS.md` completely.
2. Inspect existing code and current git status before editing.
3. Preserve user changes and specification files.
4. Select the next incomplete vertical slice from `docs/spec/IMPLEMENTATION_PLAN.md`.

## Scope controls

- Do not add MyDigitalID, Keycloak, biometrics, face recognition, ML anomaly detection, plate recognition, geofencing, live tracking, or chatbots.
- Do not describe OCR as authentication or verification.
- Do not require paid or proprietary services for local operation.
- Do not create fake integrations, fake analytics, placeholder routes, or buttons without behavior.

## Implementation standards

- Keep the application as a single Next.js/TypeScript codebase with PostgreSQL and Prisma.
- Put authorization and validation on the server for every mutation.
- Keep domain logic in testable service modules.
- Use migrations and seed data for persistence.
- Use transactions for approval, check-in, check-out, blacklist resolution, and other multi-write transitions.
- Use UTC in storage and Asia/Kuala_Lumpur in presentation.
- Never expose secrets, raw tokens, full identity values, or personal data in logs.
- Write or update tests with each feature.
- Prefer small, reviewable changes. Do not rewrite unrelated files.

## Verification before handoff

Run and report:

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. `npm run test:e2e`
5. `npm run build`

Also apply migrations to a clean database, run the seed, and manually verify the role-specific navigation and the full appointment-to-check-out path. A task is not complete if checks are skipped or failing.

## Handoff format

Report changed modules, migrations, tests added, commands executed, results, remaining limitations, and any safe follow-up. Never claim unverified completion.
