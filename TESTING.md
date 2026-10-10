# Verification and event rehearsal

## Automated commands

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

For an installed Windows Edge browser, use `$env:PLAYWRIGHT_CHANNEL='msedge'` before the browser command. Browser smoke tests intentionally run **without Supabase credentials** and verify that unconfigured operations fail visibly. The Playwright web server explicitly clears the service-role key and never reuses an existing app server; it does not use a production account.

Tests exercise real PostgreSQL semantics in PGlite after applying the core, email-verification and QR-inventory migrations, with minimal local stand-ins for Supabase Auth roles. Coverage includes registration/IDs, duplicate phone/email, OTP attempt limits, challenge reuse, registration closure, token encryption/validation, regeneration/revocation, exit/return/cross-gate logic, duplicate requests, manual return/audit, overdue boundaries, staff permissions, RLS table/function grants, Realtime signal visibility, lease expiry, and rate limiting. OTP adapter tests use mocked external Auth responses; they do not send SMS.

PGlite tests are sequential and **do not claim concurrent-connection coverage**. For genuine races:

```sh
# Set TEST_DATABASE_URL to an EMPTY disposable database with all application schema migrations.
npm run test:db
```

This test opens two PostgreSQL connections and races two verified claimants for one card, same-participant exits, returns, and independent gate scans. It refuses databases that already contain staff or participants, creates UUID-scoped fixtures, and deletes only those fixtures afterward. It requires a database owner connection for fixture provisioning. It never uses the live application connection automatically.

## Checks performed during implementation

- Production Next.js build and TypeScript checks passed.
- Unit, API, migrated-database, OTP and notification tests passed. The archive test validates CRCs and dimensions for 300 PNGs and decodes all 300 QR regions back to their registration URLs.
- Twelve desktop/mobile browser checks passed using installed Edge, including the registration/phone OTP/activation UI with an explicitly mocked provider API.
- Native PostgreSQL 18 multi-connection races passed, including one successful concurrent QR claim: exactly one exit/return for a simultaneous same-participant scan, independent two-gate processing, one manual-return winner, and exclusive lease acquisition.

Hosted Supabase Auth, SMS delivery, Realtime websocket transport, actual pg_cron scheduling, physical camera capture and operating-system alerts require the following configured rehearsal. All application schema migrations were applied to native PostgreSQL; Cron migration depends on the Supabase pg_cron environment.

## Live acceptance checklist

Use a staging Supabase project, two gate laptops, an admin browser, and two participant phones. Use HTTPS. Do not seed production with test attendees.

1. Apply all four migrations; check Cron job runs and Realtime publication. Bootstrap admin; create Exit 1 and Exit 2 volunteers.
2. Generate 300 QRs in Event settings. Confirm zero new participants, 300 unique PNG filenames/serial labels, valid ZIP extraction and scannable printed URLs. Generate another batch; existing codes must remain valid. Open registration and scan separate assigned cards.
3. Fill all six fields, request a real phone code, reject a wrong code, verify the correct one. Check participant ID and original-card activation; no replacement QR should appear. Try claiming the same card on the other phone; it must be rejected.
4. Repeat registration with the same phone, then same normalized email; confirm rejection and no extra participant.
5. Sign in both volunteers. Attempt a third browser at an occupied gate; confirm rejection. Verify a volunteer cannot open admin routes or mutate settings/QRs.
6. Scan the first pass at Exit 1. Check visible EXIT confirmation, outside count and live duration on both gates/admin.
7. Hold the QR in front of the camera for over ten seconds: it must remain one exit. Remove it, then scan rapidly at both gates: no duplicate movement.
8. Select Exit only at Exit 2 while the person is outside: reject. Select Return only at Exit 2: allow return, store both original/return gates and duration.
9. Refresh browsers and restart the web server; persistent state must remain correct.
10. Exit the second participant. In staging only, age the exit timestamp to just before 30 minutes (or wait). Observe red alert, one sound and one notification on enabled browsers. Verify `overdue` and audit after the scheduled job runs with browsers closed.
11. Reopen monitoring; the unresolved overdue participant remains visible. Scan return and confirm it clears everywhere.
12. Create another exit; manually return from participant search. Check confirmation, duration, `manual` method and actor in the audit trail. A second manual return must be rejected.
13. Search/filter inventory by serial, status and batch. Re-download a batch. Revoke an unassigned card (registration must fail), then a claimed card (scanning must fail). Existing participant/history remains. Legacy-only QR regeneration must still work.
14. Disable network: scanner stops and no success appears. Restore network, verify backend online status before scanning. Disconnect only Realtime: warning appears while polling keeps data current.
15. Log out a volunteer and confirm actions stop. Verify another login can acquire the gate; separately let a lease expire and confirm stale actions fail.
16. Close registration between requesting and verifying a phone code; no participant should be created. Reopen and complete a fresh registration.
17. Check analytics, participant history, registration audit, volunteer audit, and wrong/unknown QR error states.
18. Review SMS provider sending/spending limits, clock/time display (IST), camera lighting, backup connectivity, notifications, backups and access-log token redaction before using the system at the event.

No lint script or ESLint configuration exists in this repository. Prettier checks changed TypeScript/TSX files; TypeScript and the production build provide the configured static checks. No new lint framework was introduced.
