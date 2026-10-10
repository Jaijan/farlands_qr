# QR-first workflow change plan

The existing npm / Next.js App Router / React / TypeScript app uses global CSS and
Tailwind, Lucide, Supabase Auth for staff, a server-only catch-all API, and PostgreSQL
RPCs for attendance. Vitest/PGlite and Playwright are already configured.

Existing working operations: gate leases, row-locked scan transitions, cross-exit
returns, manual return audit, partial unique active-session index, pg_cron overdue
updates, snapshot reconciliation, browser/audio alerts and local notification dedupe.

1. Add a forward migration for batches, hashed inventory and challenge bindings;
   retain legacy participants, QR secrets, attendance and the edited email migration.
2. Replace the generic registration QR card in Event settings with bulk generation,
   ZIP download/re-download, status counts, filters and revocation. Preserve components.
3. Bind six-field registration to inventory; verify real phone OTP before an atomic
   claim. Fail closed on absent provider configuration. Keep success-page styling.
4. Accept canonical registration URLs at the existing scanner while retaining legacy
   FARLANDS tokens. Reuse existing attendance locks, leases and scheduled monitoring.
5. Exercise inventory, claims, OTP, archives, authorization and existing attendance
   tests, plus native PostgreSQL concurrency and browser checks where available.
6. Document deployment, SMS credentials/cost limits, safe migration and rehearsal.
