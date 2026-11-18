# Phase 2 — Accounts, tournament workflows, and match predictions

Status: original proposal, followed by user authorization to implement Phase 2. See [PHASE2_IMPLEMENTATION.md](PHASE2_IMPLEMENTATION.md) for delivered behavior and operational setup. The user confirmed that “bidding” means staking points on match winners; implementation adopts the recommended defaults below.

## Outcome

An organizer can create and run an event, participants can register and manage their entries, and approved prediction participants can stake virtual points on match outcomes. Competition standings and prediction rankings remain separate.

## Current foundation

- React tournament screens, roster, bracket generation, scheduling, score entry, corrections, and activity history.
- Fastify API, Socket.IO invalidation, brackets-manager, PostgreSQL, transactional tournament documents, and revision checks.
- Public viewing and a shared administrator key. There are no individual accounts, participant self-registration, tournament memberships, or point wallets yet.

## Milestone A — Individual accounts and permissions

### Roles and access

| Role          | Access                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Guest         | Browse public events, brackets, and published leaderboards.                                                                        |
| Participant   | Maintain profile, request tournament entry, check in, see own matches, submit result evidence, and join eligible prediction pools. |
| Operator      | Check in entrants, schedule/start matches, review result submissions, and report official results for assigned tournaments.        |
| Administrator | Create/configure events, approve entries, assign staff, finalize results, manage disputes, and review audit records.               |

Staff permissions are tournament-scoped. Administrative accounts and promotions are provisioned by an existing administrator; public registration never grants staff access.

### Account workflow

Register → verify email → complete profile → discover tournament → request entry → organizer approval → check in → participate.

Provide registration, login, logout, forgot/reset password, profile, and session management. Administrator login can have a dedicated `/admin/login` entry point, using the same authentication system and server-side permission checks. Redirect each signed-in user to the appropriate dashboard. Require stronger authentication for administrators before public release.

Keep accounts separate from competitive identities: a user can manage a player profile or captain a team. A tournament entry belongs to a player/team; a prediction wallet belongs to an individual user. Someone need not be competing in the bracket to be an approved prediction participant, if the organizer enables that policy.

Migrate away from the shared admin key and unrestricted development access once individual account management is enabled. Preserve existing tournament and player data.

## Milestone B — Complete the tournament workflows and tabs

### Organizer lifecycle

Draft → registration open → registration closed → check-in → seeded → in progress → results confirmed → completed → archived.

Track registration and check-in explicitly; do not overload the existing tournament status with every operational detail. Bracket generation locks competitive entries and seeds. Match states gain an explicit start operation, rather than treating every ready match as already running.

### Result workflow

Participant submits a score/evidence → opponent can confirm or dispute → operator reviews → official result passes through brackets-manager → administrator finalizes the prediction result → points settle.

Only authorized staff can alter official results. Participant submissions do not directly advance the bracket. Staff actions identify the actor in the audit history.

### Screen coverage

| Screen             | Participant experience                                                | Organizer experience                                                       |
| ------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Overview           | Joined events, next match, entry/check-in status, prediction balance. | Event readiness, pending approvals, unresolved disputes, upcoming matches. |
| Tournaments        | Browse and join eligible events.                                      | Create events, control registration, manage lifecycle.                     |
| Participants       | Profile, team roster, own entry and check-in.                         | Approvals, seeds, check-in, team membership, disqualification reasons.     |
| Bracket            | Official progression and match details.                               | Engine-backed tournament control.                                          |
| Matches            | Own match instructions, evidence submission, eligible predictions.    | Start matches, review results, handle disputes, finalize outcomes.         |
| Schedule           | Local-time schedule and server/court information.                     | Assign times/venues, identify conflicts, reschedule with history.          |
| Predictions — new  | Open/locked/settled predictions, stake form, pool information.        | Enable pools, lock/void markets, review settlement state.                  |
| Points — new       | Available, reserved, pending returns, transaction history.            | Reasoned adjustments and reconciliation records.                           |
| Leaderboards — new | Separate competition and prediction rankings.                         | Publish standings and prediction rules.                                    |
| Activity           | Public event changes and own account/points history.                  | Staff audit with actor, before/after state, and reason.                    |
| Settings           | Profile, password, sessions, notification preferences.                | Event rules, staff permissions, registration and prediction settings.      |

Restrict sensitive audit and account data on the server, not only through hidden controls.

## Milestone C — 100-point match predictions

### Proposed launch rules

1. Each approved prediction participant receives 100 free points per tournament, once. Returning to the app or rejoining the tournament does not issue another grant.
2. Points remain inside the app, with no purchasing, transfers, cash redemption, or monetary prizes based on prediction balances.
3. Every eligible match offers a winner prediction once both opponents are known. Round-robin draws need either an explicit draw option or a published void-and-refund rule; recommend the latter for the first release.
4. Available points can be spread across multiple matches. Reserving a stake immediately reduces the spendable balance. No overdrafts or duplicate spending.
5. One prediction per user per match, editable or cancellable before lock. Editing atomically releases the old reservation and reserves the new amount.
6. Lock predictions at the earlier of the scheduled start or the operator's explicit Start Match action. The server enforces the deadline. Starting late does not automatically reopen a market; an organizer must explicitly reopen it before play with an audit reason.
7. Recommended initial stake limit: 25 points per match, minimum 1. This keeps one early loss from exhausting the whole tournament balance. The limit is a proposed configurable rule.
8. A participant who reaches zero can still play tournament matches and view predictions/leaderboards; no automatic top-ups during the same tournament.
9. Keep selections and pool totals private until lock for the first release. Staff with result/finalization authority cannot predict matches they control. Recommended eligibility policy: competitors cannot predict their own matches; this needs user approval because the original idea included any/every game.

### Proposed payout: proportional pool

Combine stakes on both sides. After an official result is finalized, distribute the pool among correct predictions in proportion to their stakes. This avoids promising fixed returns that the pool cannot fund. Pool totals and estimated returns are not guaranteed until lock.

Example: Team A has 60 points staked, Team B has 40. A participant stakes 15 on A. If A wins, that participant receives `100 × 15 / 60 = 25` points total: the original 15 plus 10 profit. Starting from 100, their available balance was 85 while the stake was reserved and becomes 110 on settlement, assuming no other predictions.

Use integer points with deterministic largest-remainder allocation so the full pool is accounted for. No fee. If all stakes are on one side, everyone receives their original stake back, regardless of outcome. Cancelled/unplayed matches, unsupported draws, and declared invalid markets return reserved stakes. Publish how forfeits are treated; recommend voiding them initially.

Prediction ranking uses tournament point equity: available balance + reserved stakes, after pending results settle. Show pending exposure separately, and give equal ranks for equal totals. Use correct predictions and net returns as additional statistics, not hidden ranking rules.

### Settlement and corrections

Use an explicit sequence: open → locked → result pending → finalized/settled, or voided/refunded. Finalization must happen once, even after retries or simultaneous requests. A configurable review window can precede finalization.

Before settlement, an approved result correction can update the pending outcome. After settlement, block the ordinary correction endpoint for that match until an administrator resolves its prediction consequences. Do not simply deduct old payouts: users may already have reserved or spent them. A separate, audited reconciliation workflow must define and resolve this case before allowing post-settlement overrides. Launch acceptance must cover it; hiding this edge case would make balances unreliable.

### Data and transaction boundaries

Add relational models for User, Session, account verification/recovery tokens, TournamentMembership, TeamMembership, MatchSubmission, PredictionMarket, Prediction, Wallet, LedgerEntry, and Settlement. Retain the existing bracket adapter and canonical tournament data.

Engine match IDs currently restart within each tournament. Markets, result submissions, and settlements must use a compound tournament/stage/match identity rather than a match ID alone.

Use an append-only points ledger for grants, reservations/releases, payouts, refunds, and reasoned adjustments. Enforce unique initial grants and settlements at the database level. Keep wallet reservation and prediction creation/editing in one transaction, and atomically synchronize market locks with match starts. Include an actor and idempotency key in financial-like state changes. Persist these records in PostgreSQL rather than inside a loosely structured tournament document.

## Delivery order and acceptance

1. Accounts, invitations/bootstrap, sessions, permission checks, profile, recovery, and data migration.
2. Tournament registration, team ownership, approval, check-in, explicit match start, result submission/review, and complete role-specific tabs.
3. Points ledger and grants, stake reservation, lock deadlines, prediction interface, settlement/refunds, leaderboard, and audited reconciliation.
4. Email delivery configuration, administrator authentication hardening, abuse controls, deployment rehearsal, backups, and concurrency/load testing.

Acceptance includes attempts to promote a participant to admin, read another user's private records, issue a second initial grant, spend the same balance concurrently, change a locked prediction, settle/refund twice, tamper with the browser's clock, collide match IDs across events, submit results without permission, and correct an already-settled result. Check that point totals reconcile after every allowed workflow and that account/tournament/ledger data survive restart and backup restore.

## Decisions to approve before implementing predictions

- 100 points per tournament versus one persistent lifetime balance — recommend per tournament.
- Proportional pool versus fixed rewards — recommend proportional pool.
- Maximum stake — recommend 25 points per match initially.
- Eligibility for competitors' own matches and staff-controlled matches.
- Treatment of draws, forfeits, zero balances, and exceptional post-settlement corrections.

Build accounts and tournament workflows first. The prediction feature depends on verified identity, event membership, permissions, reliable match start/finalization, and an auditable ledger.
