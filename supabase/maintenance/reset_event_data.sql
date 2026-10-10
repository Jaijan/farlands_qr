-- ONE-TIME DESTRUCTIVE RESET. Run manually in the Supabase SQL Editor.
-- Removes all participants, attendance, QR batches/cards and pending registrations.
-- Preserves staff accounts, gate sessions, settings and staff/settings audit entries.
-- Run while registration and gate scanning are idle; refresh all dashboards afterward.
-- Kept outside migrations so deploying the app cannot trigger a reset.
begin;
set local lock_timeout = '10s';

lock table public.settings, public.registration_challenges, public.qr_batches,
 public.qr_inventory, public.qr_inventory_secrets, public.participants,
 public.exit_sessions, public.scan_requests, public.qr_secrets,
 public.revoked_tokens, public.audit_logs in access exclusive mode;

delete from public.audit_logs
 where participant_id is not null
    or actor_type = 'participant'
    or action in ('qr_batch_generated', 'inventory_qr_revoked');
delete from public.scan_requests;
delete from public.registration_challenges;
delete from public.exit_sessions;
delete from public.qr_secrets;
delete from public.revoked_tokens;
delete from public.qr_inventory_secrets;
delete from public.qr_inventory;
delete from public.qr_batches;
delete from public.participants;

-- Standalone sequences are reset explicitly, within the transaction.
-- Preserve the application's existing serial format: FARL-QR-0001 / FARL-0001.
alter sequence public.qr_serial_number restart with 1;
alter sequence public.participant_number restart with 1;

update public.event_signal
 set version = version + 1, updated_at = clock_timestamp() where id;

commit;

select
 (select count(*) from public.participants) as participants_remaining,
 (select count(*) from public.exit_sessions) as attendance_remaining,
 (select count(*) from public.qr_inventory) as qr_codes_remaining,
 (select count(*) from public.qr_batches) as qr_batches_remaining,
 (select count(*) from public.registration_challenges) as challenges_remaining;
