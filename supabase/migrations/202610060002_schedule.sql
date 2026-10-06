-- Enable Supabase Cron in the dashboard before applying this migration if needed.
create extension if not exists pg_cron;
select cron.schedule('farlands-overdue', '* * * * *', $$select public.mark_overdue();$$);
select cron.schedule('farlands-housekeeping', '17 * * * *', $$
 delete from public.rate_limits where window_start < now()-interval '1 day';
 delete from public.registration_challenges where expires_at < now()-interval '1 day';
 delete from public.scan_requests where created_at < now()-interval '1 day';
 update public.volunteer_sessions set active=false,logout_at=now() where active and last_seen_at <= now()-interval '90 seconds';
$$);
