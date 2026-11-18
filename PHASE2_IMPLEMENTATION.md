# Phase 2 implementation

Implemented on October 21, 2026. Existing bracket documents and player records are retained. Additive migrations introduce relational accounts, hashed sessions and tokens, tournament memberships, accepted team memberships, wallets, append-only ledger entries, prediction markets, predictions, and score submissions. Prisma schema and the migrated PostgreSQL database are checked for drift.

## Shipped interfaces

- Participant registration, verification, login, recovery/reset, and a dedicated admin login entry.
- Profiles, notification preference, password change, session revocation, authenticator enrollment/recovery codes, account access management, and existing-player ownership assignment.
- Player/team creation, captain invitations, and explicit invitation acceptance.
- Competition/prediction join requests, staff approvals, check-in, assisted check-in, registration controls, scoped operators, explicit match starts, score submissions, disputes, and official result review.
- Prediction cards, available/reserved balances, transaction history, separate prediction leaderboard, settlement, void/refund, explicit reopening of eligible unplayed markets, reconciliation, and reasoned adjustments.
- Scheduled match duration and competitor/venue overlap checks.
- Actor-attributed private staff audit records; public event feeds omit membership, points, and submission details.

## Adopted defaults

100 virtual points per approved user per event, maximum 25 per match, proportional pools with exact integer conservation, one-sided/draw/forfeit refunds, no staff or own-match predictions, no purchases/transfers/redemption, and no automatic top-ups. Stake limits lock after the first prediction. Administrators explicitly finalize outcomes; settled outcomes require audited reconciliation before corrections. Insufficient unreserved balances block reconciliation without creating debt.

There is no automatic post-settlement clawback, no direct balance-edit endpoint, and no generic match CRUD. Account promotions cannot be obtained through registration. Disabled accounts and changed privileges revoke sessions. Public production administration requires authenticator enrollment.

## Operational setup

The current development database contains the original example event, an administrator, and a demonstration prediction participant. Their generated passwords are in the ignored `data/admin-access.txt` and `data/player-access.txt`, respectively. The example pool is enabled. These are development accounts, not production seed credentials.

SMTP transport is implemented but no external mail service is configured or contacted during local testing. Development verification/reset links appear as local previews. Public DNS/TLS, off-host backups, event-scale load testing, and automated publishing/deployment remain host-specific setup. No real-money functionality is included. Evidence is a text note or URL; file uploads and email/push reminders are future extensions. Disqualification is handled by staff-recorded match forfeits rather than a separate disciplinary subsystem.

See README.md for setup, account workflows, prediction rules, production provisioning, and backup instructions. PHASE2_PLAN.md remains the original proposal; this document records the delivered behavior.
