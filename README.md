# Farlands event control

A working Next.js application for phone-verified QR claiming, bulk printed ID cards, two-gate exit/return monitoring, and administration. Designed for a single Farlands event with approximately 100–500 participants.

## Implementation and verification status

The repository contains the application, PostgreSQL migrations, Supabase Auth/Realtime integrations, phone OTP adapters, secure staff bootstrap, and automated tests. It does **not** ship with a configured Supabase project or SMS provider. Without configuration, public pages render and operations show an explicit setup error; no fake participants or successful scans are fabricated.

Verified locally: production build, TypeScript, unit/database tests, desktop/mobile browser smoke tests, and actual simultaneous scans through two native PostgreSQL connections. See [TESTING.md](TESTING.md) for coverage and the event-day acceptance checklist. Live SMS delivery, hosted Supabase Auth/Realtime, scheduled Cron execution, physical webcams, and operating-system notifications still require a rehearsal with your credentials and hardware.

## Stack and architecture

- Next.js App Router, React, TypeScript, Tailwind CSS, Lucide icons.
- Supabase PostgreSQL, Auth, Realtime, RLS, and database Cron.
- `qrcode` and `sharp` render 800x900 PNG ID cards; `jszip` packages batches; ZXing reads browser cameras.
- Web Notifications and Web Audio, behind replaceable notification channels.
- Zod validates public and administrative inputs.

```text
app/                         Public, participant, admin and volunteer routes
app/api/[...path]/route.ts    Server API: validation, verified identity, provider calls
components/                  Registration, QR, scanner, monitoring and staff screens
lib/                         Authentication, Supabase clients, OTP, crypto and notifications
supabase/migrations/         Tables, constraints, RLS, transactions and scheduled jobs
scripts/                     Admin bootstrap and real concurrent-connection testing
tests/                       Database, security, OTP and browser tests
```

All personal-data access goes through the server API. Browser clients cannot read participant, credential, audit, or session tables directly. The only browser-readable database table is a staff-only Realtime invalidation counter. Clients receive that signal and fetch an authorized, transactionally consistent snapshot. Polling every 10 seconds provides a fallback; Realtime disconnection remains visibly distinct from backend failure.

## 1. Local setup

Install Node.js **24 or newer** (the scanner dependency requires it), then:

```sh
npm ci
cp .env.example .env.local
```

PowerShell equivalent for the second command: `Copy-Item .env.example .env.local`.

For this workspace only, a portable runtime may already exist in `.tools/node-v24.21.0-win-x64`. You can use it without installing Node globally:

```powershell
$env:PATH = (Join-Path $PWD '.tools\node-v24.21.0-win-x64') + ';' + $env:PATH
npm.cmd run dev
```

`.tools` is ignored by Git and is not required on other machines.

## 2. Supabase setup and migrations

1. Create a Supabase project. Copy its project URL, anon key, and **server-only** service-role key into `.env.local`.
2. Enable **Cron / pg_cron** in the Supabase dashboard.
3. Apply `supabase/migrations/202610060001_core.sql`, `202610060002_schedule.sql`, `202610060003_email_verification.sql`, and `202610100001_qr_inventory.sql` through the SQL editor, or use the Supabase CLI:

   ```sh
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

4. Enable Phone Auth and configure a real SMS provider in Supabase Authentication. Follow section 5 below. Keep Email/password enabled for existing staff accounts. Set the site URL to your deployed HTTPS origin. Phone signup never grants staff access.
5. Confirm `event_signal` is in the `supabase_realtime` publication (the core migration adds it). Do not publish personal-data or QR tables.
6. Verify scheduled jobs:

   ```sql
   select jobname, schedule, active from cron.job
   where jobname like 'farlands-%';
   select * from cron.job_run_details order by start_time desc limit 10;
   ```

The first migration assumes the Supabase `auth.users`, `auth.uid()`, roles, and Realtime publication exist. The second requires pg_cron. All four migrations must succeed before event use.

Optional local Supabase requires Docker and `npx supabase start`; the included config uses ports 54321/54322. Configure local SMS delivery separately. Do not use test OTP codes in production.

## 3. Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL; available to browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable client credential |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server credential; never use a `NEXT_PUBLIC_` prefix |
| `QR_ENCRYPTION_KEY` | 32 random bytes as 64 hexadecimal characters |
| `APP_ORIGIN` | Exact browser origin, e.g. `https://farlands.example.org`; used for CSRF checks and printed registration URLs |
| `OTP_PROVIDER` | Explicitly select `supabase` or `webhook`; no verification bypass |
| `PHONE_OTP_CONFIGURED` | Set `true` after enabling and testing Supabase Phone Auth/SMS |
| `OTP_WEBHOOK_URL` | HTTPS endpoint for your replaceable phone OTP adapter, if selected |
| `OTP_WEBHOOK_SECRET` | Bearer secret for that endpoint |
| `TRUST_PROXY` | `true` only when your proxy overwrites X-Forwarded-For; enables extra per-IP OTP limits |
| `BOOTSTRAP_ADMIN_EMAIL` | Used only by the bootstrap script |
| `BOOTSTRAP_ADMIN_PASSWORD` | At least 12 characters; remove after bootstrap |
| `BOOTSTRAP_ADMIN_NAME` | Initial administrator display name |
| `TEST_DATABASE_URL` | Optional connection to an empty, disposable migrated database |

Generate the QR key:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Store the result in `.env.local` or your deployment secret manager. Back it up separately from the database. Losing this key prevents retrieval of existing encrypted QR images; hashed QR validation still works. Rotating it requires re-encrypting stored copies or regenerating passes. Never commit environment files or log QR URLs/tokens.

## 4. Create administrator and volunteers

After applying migrations and setting bootstrap variables:

```sh
npm run bootstrap
```

The script creates a confirmed Supabase Auth user and administrator profile. It refuses to overwrite an existing administrator. Remove the bootstrap password from your environment afterward.

Sign in at `/admin/login`, open **Gate volunteers**, and create:

- Volunteer 1 assigned to **Exit 1**.
- Volunteer 2 assigned to **Exit 2**.

Use strong unique passwords and share them privately. Volunteers sign in using their staff email (stored as `username`). A unique index permits only one active volunteer account for each of the two exits. Inactive accounts remain for audit history. Deactivate a volunteer before provisioning a replacement. For lost staff passwords, use the Supabase administrative Auth recovery/reset workflow; the app never stores passwords itself.

A volunteer login acquires an exclusive gate lease. The browser sends a heartbeat every 20 seconds; leases expire after 90 seconds without a heartbeat. Another browser cannot acquire the same gate until logout or expiry. Refreshes preserve the HTTP-only lease cookie. A stale/disabled lease cannot scan, read the dashboard, or manually return a participant. Administrators are not counted against the two gates.

## 5. OTP provider configuration

### Supabase Phone Auth

Set `OTP_PROVIDER=supabase`. Enable Phone Auth/signup and configure an SMS provider in the Supabase dashboard. For Twilio, provide its Account SID, Auth Token and Messaging Service SID in Supabase, never in browser variables. Set OTP expiry to at most 600 seconds and resend frequency to at least 60 seconds. Disable all fixed test phone codes and auto-confirmation in production. After testing real delivery, set `PHONE_OTP_CONFIGURED=true`. Until then the application shows a setup error and refuses registration.

This uses ordinary phone sign-in, not paid phone MFA. Supabase's Free plan currently includes 50,000 monthly active users, but SMS delivery is billed separately by the provider. Supabase's documented default SMS cap is 30/hour, too low for 300 arrivals; configure the project limit and provider spending controls for the event. Twilio trials require verified recipient numbers and are unsuitable for unrestricted participant registration; production delivery requires a funded account and any destination-specific sender registration. No free public SMS allowance is promised. References checked 10 October 2026: [Phone Auth](https://supabase.com/docs/guides/auth/phone-login), [Auth usage](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users), [rate limits](https://supabase.com/docs/guides/auth/rate-limits), [Twilio trial restrictions](https://www.twilio.com/docs/usage/trials).

Application limits are durable in PostgreSQL: one send/phone/60 seconds, three sends per phone/email/QR per ten minutes, 1,200 global send attempts/hour, five verification attempts/challenge and fifteen verification attempts/phone/ten minutes. Challenges expire in ten minutes. Trusted proxy IP throttling is optional; configure it only behind a proxy that overwrites the header. Provider limits still apply to direct Supabase Auth calls. Enable provider fraud protection and spending caps before opening registration.

### Replaceable webhook provider

Set `OTP_PROVIDER=webhook`, an HTTPS `OTP_WEBHOOK_URL`, and `OTP_WEBHOOK_SECRET`. The server sends JSON authenticated with `Authorization: Bearer <secret>`:

~~~json
{"action":"send","phone":"+919876543210"}
{"action":"verify","phone":"+919876543210","code":"123456"}
~~~

Send must return `{"sent":true}`. Verify must return `{"verified":true}` only for a genuine, unexpired, one-use code for that exact normalized phone. Invalid codes return false. Enforce expiry, replay protection and attempts at the provider too. Calls time out after fifteen seconds. A missing adapter, non-HTTPS URL, rejected send, or failed verification never creates a participant. Choose a provider supported in your destination; its billing and sender credentials remain server-side.

## 6. Run and deploy

```sh
npm run dev
# http://localhost:3000

npm run typecheck
npm test
npm run build
npm start
```

Deploy to a Node.js 24-capable Next.js host. Set all required environment variables before building because `NEXT_PUBLIC_*` variables are embedded in the browser bundle. Use HTTPS for cameras/notifications, set `APP_ORIGIN` exactly, and rebuild after public Supabase configuration changes. Keep application instances stateless; rate limits, leases, registration state, and movements are stored in PostgreSQL.

Use a reverse proxy request-body limit, redact `/participant/*` paths and the `key` query parameter on `/register` in access logs, disable request-body logging for `/api/*`, and do not attach third-party analytics to private QR pages. Those URLs are bearer credentials. Configure the CSP connection origins in `next.config.ts` if using a custom Supabase domain. Secure lease cookies require HTTPS in production (localhost is suitable for development).

The app is not a static export and must not be deployed as static files. Database Cron runs in Supabase independently of your web host. Verify database backup/restore and prevent project suspension during the event. Keep an alternate internet connection available at both gates.

## 7. Registration and QR behavior

Open **Event settings** at `/admin/settings`, choose a quantity (default 300, maximum 1,000), and select **Generate & download ZIP**. Generation creates inventory only. Each 800x900 white PNG has a four-module QR quiet zone and a readable `FARL-QR-0001` serial underneath. The ZIP contains one PNG per ID card. Batch IDs make generation retries idempotent; persisted encrypted copies support re-download after a failed download. Filters show status, serial and batch. Re-downloading preserves the original batch, including revoked codes which remain unusable. Protect ZIPs like physical passes.

Print the cards after setting the final canonical `APP_ORIGIN`. Each QR contains `https://your-domain/register?key=<256-bit-random-token>`. Do not change that domain after printing without preserving its routing. Serial numbers, participant IDs and tokens are separate; serials are never credentials. Public registration and inventory responses never reveal other tokens or participant data. Inventory stores SHA-256 token hashes; a separate service-only table stores AES-256-GCM encrypted recovery copies. Audit logs and CSV exports omit tokens.

A participant scans their assigned card, completes the existing six fields and verifies their phone. A challenge stores immutable details and its QR association; an HTTP-only SameSite cookie binds verification to that browser. The verification endpoint accepts only challenge ID/code, never a replacement QR. The server checks SMS with the provider, then a transaction locks registration settings, the challenge and QR, creates the participant and claims the inventory record together. Uniqueness protects normalized phone/email. Failed transactions leave the QR unassigned. Concurrent claims allow one winner. Lost success responses can be retried with the bound challenge without creating another participant. If provider verification succeeded but the response was lost before recording that fact, request a fresh OTP after cooldown.

The success page confirms `FARL-0001` and activation of the **original printed ID card**; it does not issue a new QR. Closing registration blocks new claims without affecting existing attendance. Opening a registration URL never claims a card. Claimed/revoked URLs show an error. `/registration-screen` now instructs participants to scan their assigned cards instead of distributing one shared credential.

### Safe upgrade and legacy passes

Back up the database and QR encryption key. Apply the new migration after the three existing migrations; never edit/re-run historical migrations on a deployed database. The existing email-verification migration is retained. No participant, attendance, audit, or QR secret is deleted or reissued. Legacy `FARLANDS:<token>` passes and private participant URLs keep working. Legacy email-only verification is displayed accurately; no historical phone is falsely marked verified. Existing in-flight registration-first challenges must restart with an assigned card. Deploy the app and migration together in a registration maintenance window: the old issuance RPC is deliberately disabled.

Inventory cards cannot be regenerated; revocation disables the credential while retaining participant history and manual-return ability. Legacy passes retain their existing admin regeneration controls. For a lost printed card, an administrator can retrieve its existing QR after verifying identity; do not activate another participant record for that person. Sequence gaps after rollback are expected, and identifiers continue beyond 9999 without truncation.

## 8. Exit and return transactions

Volunteer cameras start only after an explicit camera permission interaction. Then scans proceed without a per-scan button. The scanner has three modes:

- **Auto detect:** inside → EXIT, outside → RETURN.
- **Exit only:** reject someone already outside.
- **Return only:** reject someone currently inside; allow either physical return gate.

This distinction resolves an ambiguity in the brief: a QR and stored status alone cannot reveal whether someone intends to return or is mistakenly trying to exit again. Use explicit modes where direction must be enforced.

Every scan verifies current staff identity and gate lease. A transaction locks the participant row, validates status, creates/closes the exit session, changes participant state, and logs the action. A partial unique index guarantees at most one open session. The original exit and return exit are stored separately, along with staff actors and duration from server timestamps.

Five-second database debounce handles simultaneous/rapid scans across gates. Unique request IDs make network retries idempotent. The camera also waits for a presented code to leave its field of view before accepting it again, preventing a pass held continuously in front of the camera from alternating exit/return. Remove the QR briefly before scanning again. No offline queue exists: failed/uncertain network responses are not shown as success. After an ambiguous timeout, inspect current state before attempting a new movement.

Manual returns require confirmation and use the same participant row lock. Their audit log includes the actor; the session stores `return_method=manual`. An administrator manual return has no physical return gate, and is labelled Admin.

## 9. Overdue monitoring and alerts

`exited_at + 30 minutes` is the authoritative threshold. Supabase Cron runs `mark_overdue()` every minute whether or not any browser is open, persisting overdue state and one audit event. Authorized snapshots also run that function. Dashboard timers compare server-adjusted time against the same threshold, so red alerts appear immediately at 30 minutes while the scheduled status write can lag by up to a minute.

Staff click **Enable alerts** once per browser session to unlock audio and request notification permission. New overdue sessions trigger one browser notification and one sound per browser storage profile/session ID; an in-memory fallback handles blocked browser storage. Visible unresolved alerts remain until return. A newly opened dashboard still shows all unresolved overdue people. Browser notifications require the dashboard to remain running; database monitoring does not. There is no push notification/SMS alarm while every browser is closed in the initial implementation.

`lib/notifications.ts` defines notification channels; add optional SMS/WhatsApp delivery as a server-side worker/outbox integration so secrets and delivery retries remain outside browsers. This optional future transport is not required for current browser/sound alerts.

## 10. Security model

- Every table has RLS. Anonymous and authenticated browser roles have no direct personal-data or mutation privileges.
- Only active staff can read the Realtime signal; all detailed snapshots require server identity/role/lease checks.
- All database mutation functions revoke execution from public/anon/authenticated; only the server service-role client calls them. Functions independently verify actor roles and lease state.
- Admin/volunteer route layouts are protected. Every API operation reauthorizes; hiding UI elements is not authorization.
- Supabase Auth hashes staff passwords. Service-role and QR encryption keys remain server-side.
- Same-origin POST validation, input validation, durable rate limits, OTP expiry/attempt limits, server timestamps, and transactional constraints protect operations.
- Browser personal-data responses are uncached. QR pages send no-referrer/noindex headers. No arbitrary HTML is rendered.
- Audit history has no edit/delete API. Privileged database administrators still have database-level control; this is not external tamper-proof storage.
- No permissive test policies, sample admin passwords, OTP bypasses, or fixture participants are included in the deployed app.

## 11. Troubleshooting

| Symptom | Check |
| --- | --- |
| System setup required | Fill the four Supabase/QR variables and restart/rebuild |
| Invalid request origin | Match `APP_ORIGIN` to the actual browser scheme/host/port; remove trailing paths |
| Cannot send OTP | Phone Auth enabled, SMS credentials/sender configuration, PHONE_OTP_CONFIGURED, provider limits, Supabase Auth logs |
| Verification expired | Request a new code; five attempts or ten minutes expire a challenge |
| Duplicate registration | Search phone/email as admin; retrieve the existing pass instead |
| Exit occupied | Log out the old browser or wait 90 seconds; never bypass the lease constraint |
| Exit session expired | Sign in again; sleeping/background devices may stop heartbeats |
| Camera denied | Allow browser camera access, check webcam availability, use HTTPS/localhost |
| Realtime disconnected | Check publication, Auth session, websocket access; 10-second polling continues |
| System offline | Restore backend/internet; do not infer successful movements from a failed request |
| No audible/browser alerts | Click Enable alerts, allow notifications/audio, check OS focus mode; keep dashboard open |
| QR revoked | Check inventory status; revoked printed cards cannot be regenerated |
| Cannot decrypt existing QR | Restore the original encryption key; existing printed cards must retain their tokens |
| Overdue not persisted | Check pg_cron jobs/run details; manually inspect `select public.mark_overdue()` as DB admin |

Before event day, complete the live rehearsal in [TESTING.md](TESTING.md). Automated checks cannot certify SMS delivery, browser permissions, network reliability, or an unconfigured Supabase project.
