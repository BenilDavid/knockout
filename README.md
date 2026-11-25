# Knockout

Self-hosted tournament management with individual accounts, tournament workflows, and a free virtual-points prediction competition. React/Vite, BeUI, Fastify/Socket.IO, brackets-manager 1.11.1, Prisma 6.17.1, PostgreSQL 18, and Caddy.

### BeUI bracket

The elimination bracket uses the actual [BeUI knockout-bracket](https://beui.dev/components/blocks/knockout-bracket) registry source, installed from `apps/web` with:

```powershell
pnpm dlx shadcn@latest add @beui/knockout-bracket
```

`apps/web/components.json` configures the `@beui` registry. Shadcn copies the component into `apps/web/src/components/motion/knockout-bracket.tsx`, with `lib/ease.ts` and `lib/utils.ts`; BeUI is source code in this project, not a package named `@beui/knockout-bracket` in package.json. Motion, Tailwind CSS v4, clsx and tailwind-merge support it. Application dependency installation remains `npm ci` using the root package-lock.json.

The adapter supplies real tournament rounds, scores, byes and match states. Local extensions add accessible match selection, preserve the existing match workflow, and support the one-to-one advancing rounds in a double-elimination lower bracket. Round-robin fixtures retain the match-list layout because they are not elimination trees. The sample football data is removed. Review these local extensions before using shadcn to overwrite the component. BeUI owns the animated display; brackets-manager remains the tournament rules engine.

## Start development

Requires Node.js 22.14+, npm, and Docker Desktop for PostgreSQL.

```powershell
npm ci
npm run db:generate
docker compose -f compose.db.yaml up -d --wait
```

Copy `.env.example` to `.env` and set:

```dotenv
DATABASE_URL=postgresql://knockout:knockout_dev@localhost:55432/knockout
PUBLIC_ORIGIN=http://127.0.0.1:5173
```

Then, from the project root:

```powershell
npm run db:migrate
npm run admin:create
npm run dev
```

Open http://127.0.0.1:5173. Administrator sign-in also has a dedicated entry at http://127.0.0.1:5173/admin/login. With no ADMIN_PASSWORD environment variable, the provisioning command generates a unique password and writes it to the ignored `data/admin-access.txt`. Existing accounts and passwords are preserved on rerun. `--email someone@example.com` selects another admin email. Public registration always creates a participant, never an administrator.

The provisioning command creates a stable local SESSION_SECRET in `.env` if absent. Keep it private and stable: it encrypts authenticator secrets. Account settings supports password changes, two-factor setup, recovery codes, profile preferences, active sessions, teams, and admin account management.

Without DATABASE_URL, the application uses `data/knockout.json` and seeds an example tournament on its first start. Authentication and the same ledger checks still apply. PostgreSQL and file storage are separate workspaces; neither automatically imports or overwrites the other. Use `npm run db:seed` to add the example tournament to an empty development database. Optionally run `npm run db:seed-community` to enable predictions for that example and create a demonstration participant, whose unique credentials are saved in `data/player-access.txt`. Demo seed commands refuse production operation.

On Windows, stop the API before regenerating Prisma if Windows reports a locked query-engine DLL; restart the API afterward.

## Account and event workflows

- Participants register, verify email, create a player/team profile, request competition or prediction membership, and wait for approval.
- Admins configure registration, approve entrants, and open check-in in **Community / Event management**. Approved competition entrants must check in before bracket generation; operators can assist with check-in.
- Admins can connect existing player/team records to registered captains in **My account**, preserving earlier tournaments. Captains invite verified accounts to teams; invitees accept in their account screen.
- Admins assign tournament-specific operators. Operators can start/schedule matches, review submissions, and confirm official results; they cannot manage unrelated events or settle points.
- Competitors submit scores/evidence from the match dialog. Opponents can confirm/dispute; staff approval passes the official score through brackets-manager and advances winners.
- Admins finalize prediction outcomes separately. An unconfirmed score does not pay points.
- Single elimination, double elimination, BYEs, round robin, scheduling, stream links, corrections, JSON export, and activity history remain available.

Match scheduling includes a duration (30 minutes by default). Overlapping assignments to the same named server/court/venue or the same known competitor are rejected, including across events. This is an operational check, not an automated scheduling optimizer.

## Prediction rules

- One 100-point grant per approved user per tournament. No automatic top-ups, purchases, transfers, cash redemption, or monetary prediction prizes.
- Default stakes: 1–25 points per match, configurable up to 100 before the first prediction. One selection per user per match, editable/cancellable while open.
- Reserve points immediately; a balance cannot be spent twice. Zero points never blocks competition participation.
- Pools and others’ selections stay private until lock. Staff cannot predict events they manage; competitors cannot predict their own matches.
- Lock at the earlier of scheduled start or explicit staff Start Match. Moving a past deadline forward does not silently reopen the market. An administrator may explicitly reopen an unplayed, rescheduled market with an audit reason.
- Correct selections share the entire pool proportionally. Integer allocation uses largest remainders with deterministic tie-breaking. Payout includes the original stake. No fee.
- Draws, forfeits, one-sided pools, cancellations, and invalidated lineups refund original stakes. A voided market stays closed.
- Settlement is idempotent. A result with a settled market cannot be edited until an administrator reconciles the market.
- Reconciliation reverses payouts and refunds stakes atomically. If unreserved balances are insufficient, it rejects without changing anything. An admin can resolve this by releasing eligible stakes or making a separately reasoned, idempotent wallet adjustment; the app never silently creates debt.
- Prediction ranks use available + reserved points, with equal ranks for equal totals. Tournament competition standings remain separate.

Points history, prediction cards, result review, and leaderboards are available in their dedicated tabs. Authentication and permissions are enforced by the API, not just hidden controls.

## Email

Production account verification and password recovery require MAIL_FROM plus an email provider. [Resend](https://resend.com) is used when RESEND_API_KEY is set:

```dotenv
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
MAIL_FROM=Knockout <no-reply@example.com>
```

Verify the MAIL_FROM domain in the Resend dashboard first, or Resend rejects the send. Any SMTP server still works as a fallback when RESEND_API_KEY is not set (Resend wins if both are set):

```dotenv
SMTP_URL=smtps://username:URL_ENCODED_PASSWORD@mail.example.com:465
MAIL_FROM=Knockout <no-reply@example.com>
```

### Manual verification

If email cannot reach every user (for example Resend's `onboarding@resend.dev` sender only delivers to your own address), set `MANUAL_VERIFICATION=true`:

- Registration succeeds even when the verification email cannot be sent, and the user is told an administrator will approve the account.
- Unverified accounts are listed first under **Account management**. Choose **Verify account**, enter a reason (it is recorded in the audit log), and press Apply. The user can then sign in.
- Until then, sign-in says the account is waiting for administrator approval.
- Manual verification confirms nothing about email ownership, so use it only for private or small deployments. Password-reset emails are unaffected and still need working delivery.
- When real delivery works, remove the variable. Accounts still awaiting approval can use **Resend verification** on the sign-in screen to get a normal email.

Leave it unset for the standard behaviour, where a failed verification email returns an error.

In development without a provider, registration/recovery responses show a **Local email preview** link so the complete flow can be exercised without sending mail. Production never returns those links. Tokens are hashed, expiring, single-use records. Passwords use Argon2id; sessions use opaque random tokens whose hashes are stored server-side. Resetting a password or changing account privileges revokes existing sessions. Two-factor authentication uses encrypted TOTP secrets and hashed single-use recovery codes; save the codes when shown.

In-app result notices are available through My dashboard and the account preference. Scheduled email reminders, push notifications, and evidence file uploads are not included; score evidence currently accepts a text note or URL.

## Self-hosted HTTPS deployment

1. Copy `deploy/production.env.example` to `.env` and fill in unique secrets, email settings (RESEND_API_KEY and MAIL_FROM, or SMTP), SITE_ADDRESS, and its matching HTTPS PUBLIC_ORIGIN.
2. Point DNS at the host and allow inbound 80/443.
3. Run `docker compose up --build -d`.
4. Provision an administrator using the API image (set ADMIN_EMAIL and ADMIN_PASSWORD in the shell, without committing them):

```powershell
docker compose run --rm -e ADMIN_EMAIL -e ADMIN_PASSWORD api node dist/apps/api/src/admin-create.js
```

The container inherits NODE_ENV=production and refuses password-free provisioning. Use a password of at least 12 characters. Sign in at `/admin/login`, then set up the authenticator in **My account**. Production admin operations require two-factor enrollment. Recovery codes are issued once at enrollment. Add more administrators from account management when needed; self-access changes are blocked.

Caddy serves the SPA, proxies API/Socket.IO, and obtains TLS certificates. Database/API ports are not public. Migrations must succeed before API startup, and readiness must succeed before the web service starts. Production requires PostgreSQL, a stable SESSION_SECRET (32+ characters), and an HTTPS origin. The old ADMIN_KEY is no longer used.

Use one API writer process. Transactions take a database advisory lock and save engine state, membership/workflow changes, wallets, and ledger records atomically. Unique grants/predictions/market identities and nonnegative wallet constraints are enforced in PostgreSQL. Match IDs are scoped by tournament/stage. Concurrent reads share an isolated repeatable-read snapshot; callers receive independent copies.

Readiness: `/health/ready`. Liveness: `/health/live`. Rate limits apply to requests, with tighter limits on registration/login/recovery. Only the private Caddy proxy hop is trusted in production.

## Tests

```powershell
npm run typecheck
npm test
npm run build
npm run test:postgres -w @knockout/api
```

The PostgreSQL test command requires DATABASE_URL in the shell environment. `npm test` uses isolated temporary local stores and never modifies the running workspace. Database tests create and clean up only their own records. CI runs both suites, migrations, production builds, and Docker image builds. See [VALIDATION.md](VALIDATION.md).

## Backups

Production: `.\deploy\backup.ps1` on Windows or `sh deploy/backup.sh` on Linux. Development: `.\deploy\backup.ps1 -ComposeFile compose.db.yaml`. Dumps include all account, session, membership, wallet, ledger, and engine tables. Keep dumps private and copy them off-host. Back up deployment configuration and SESSION_SECRET separately and securely; it is needed to decrypt authenticator secrets. Do not commit credentials or backups.

Restore a dump into a separate test database using `pg_restore --no-owner -d TEST_DATABASE backup.dump`, then verify engine, account, wallet, and ledger rows. Never overwrite an active event database to rehearse restoration. Scheduled backups, off-host copies, actual public DNS/TLS issuance, SMTP delivery verification, load testing, and automated publishing/deployment require host-specific configuration before a major event.
`nThe Bracket tab also offers a **Knockout wheel** view for single-elimination events, installed with `pnpm dlx shadcn@latest add @beui/knockout-wheel`. It shares the real-data adapter with the tree and loads on demand. Hover/tap nodes for details or use arrow keys to explore. Double-elimination and round-robin events keep their existing layouts because the wheel represents a single-elimination tree. The imported wheel and tooltip helpers are in `apps/web/src/components/motion`; sample data was removed and undecided match labels retain their round and known opponents.
