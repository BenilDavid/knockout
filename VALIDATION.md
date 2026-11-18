# Local validation

Verified on October 21, 2026 on Windows with Node.js 22.14 and Docker Desktop.

## Phase 2

- 23 local lifecycle, account, permissions, workflow, and prediction tests pass.
- Two PostgreSQL integration tests pass: atomic engine/audit persistence and independent-writer point reservations, rollback, restart, and concurrent isolated reads.
- TypeScript checking and production web/API builds pass.
- Four additive migrations are applied. The Prisma schema matches the live database with no detected drift.
- Account tests cover verification, password recovery, session revocation, forced role restrictions, authenticator enrollment/replacement, recovery codes, and replay rejection.
- Point tests cover one grant per user/event, private selections, reservations/edits/cancellation, deadline locks, explicit reopening, scoped permissions, payouts, deterministic integer rounding, refunds, settlement retries, protected corrections, and atomic rejection when reconciliation balances are insufficient.
- Workflow tests cover approvals, check-in, team ownership, score submissions/disputes/staff review, and schedule overlap checks.
- API and web Docker images build. The production API starts as the non-root node user, loads the native Argon2 implementation, and serves readiness through Caddy against PostgreSQL.
- Production login issues a Secure, HttpOnly session cookie. Admin operations without authenticator enrollment return 403. Registration without SMTP configuration returns 503 and does not create an account.
- Browser participant login, a 15-point prediction (85 available / 15 reserved / 100 total), prediction cards, and sign-out are verified.
- A real database dump was restored into a separate temporary database. It contained both development accounts, the demonstration wallet, and its grant/reservation ledger. All restored wallet balances reconciled exactly with ledger sums.
- Dependency audit reports zero vulnerabilities.

The running development workspace uses PostgreSQL on loopback port 55432 and Vite on 5173. Generated development credentials are in ignored local files. Authentication is required; there is no implicit local administrator or shared-key login.

## Earlier foundation

Single elimination, double elimination, round robin, BYEs, winner advancement, corrections, audit records, archive restrictions, persistence, Caddy proxying, container builds, and an engine-data backup/restore were verified during the first phase and remain covered by regression tests.

## Deployment limits

No external SMTP service has been configured or contacted. Public DNS/TLS issuance, off-host backup delivery, automatic publishing/deployment, and event-scale load testing require host-specific setup. Development verification/reset links are local previews, not proof of email delivery.

## BeUI integration
- Installed the official @beui/knockout-bracket registry item through pnpm dlx shadcn@latest.
- Type checking and production builds pass; all 26 local tests pass (23 API + 3 bracket adapter tests).
- Browser verified animated round navigation and match selection opening the existing score/schedule dialog against PostgreSQL demo data.
- BeUI MIT license retained in apps/web/public/licenses/beui.txt.

