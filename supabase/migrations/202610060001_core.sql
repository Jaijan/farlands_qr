create extension if not exists pgcrypto;
create sequence public.participant_number;
create table public.settings (id boolean primary key default true check(id), registration_open boolean not null default false);
insert into public.settings values(true, false);
create table public.participants (
 id uuid primary key default gen_random_uuid(),
 participant_code text not null unique default ('FARL-' || lpad(nextval('public.participant_number')::text, 4, '0')),
 name text not null check(length(trim(name)) between 2 and 100),
 phone text not null unique check(phone ~ '^\+[1-9][0-9]{7,14}$'),
 email text not null unique check(email = lower(email) and email like '%@%'),
 team_name text not null check(length(trim(team_name)) > 0), college_name text not null check(length(trim(college_name)) > 0),
 alternate_contact text not null check(alternate_contact ~ '^\+[1-9][0-9]{7,14}$'), phone_verified boolean not null check(phone_verified),
 qr_token_hash text unique, status text not null default 'inside' check(status in ('inside','outside','suspended')),
 last_scan_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.qr_secrets (participant_id uuid primary key references public.participants(id), encrypted_token text not null);
create table public.revoked_tokens (token_hash text primary key, participant_id uuid not null references public.participants(id), revoked_at timestamptz not null default now());
create table public.volunteers (
 id uuid primary key references auth.users(id), name text not null, username text not null unique,
 role text not null check(role in ('admin','volunteer')), assigned_exit text check(assigned_exit in ('exit_1','exit_2')),
 active boolean not null default true, created_at timestamptz not null default now(),
 check((role='volunteer' and assigned_exit is not null) or (role='admin' and assigned_exit is null))
);
create unique index two_active_volunteers on public.volunteers(assigned_exit) where active and role='volunteer';
create table public.volunteer_sessions (
 id uuid primary key default gen_random_uuid(), volunteer_id uuid not null references public.volunteers(id),
 exit_id text not null check(exit_id in ('exit_1','exit_2')), lease_hash text not null unique,
 login_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), logout_at timestamptz, active boolean not null default true
);
create unique index one_controller_per_exit on public.volunteer_sessions(exit_id) where active;
create unique index one_session_per_volunteer on public.volunteer_sessions(volunteer_id) where active;
create table public.exit_sessions (
 id uuid primary key default gen_random_uuid(), participant_id uuid not null references public.participants(id),
 exit_id text not null check(exit_id in ('exit_1','exit_2')), return_exit_id text check(return_exit_id in ('exit_1','exit_2')),
 exited_at timestamptz not null default now(), returned_at timestamptz, duration_seconds integer check(duration_seconds >= 0),
 status text not null default 'active' check(status in ('active','returned','overdue')),
 return_method text check(return_method in ('qr','manual')), exited_by uuid references public.volunteers(id), returned_by uuid references public.volunteers(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((status='returned' and returned_at is not null and duration_seconds is not null and return_method is not null) or (status in ('active','overdue') and returned_at is null and duration_seconds is null and return_method is null))
);
create unique index one_open_exit on public.exit_sessions(participant_id) where returned_at is null;
create index exit_participant on public.exit_sessions(participant_id);
create index exit_status_time on public.exit_sessions(status,exited_at);
create table public.audit_logs (id bigint generated always as identity primary key, actor_id uuid, actor_type text not null, participant_id uuid references public.participants(id), action text not null, metadata jsonb not null default '{}', created_at timestamptz not null default now());
create index audit_participant on public.audit_logs(participant_id,created_at desc);
create table public.registration_challenges (id uuid primary key default gen_random_uuid(), phone text not null, details jsonb not null, attempts integer not null default 0, expires_at timestamptz not null default now()+interval '10 minutes', consumed_at timestamptz);
create table public.rate_limits (key text primary key, window_start timestamptz not null, count integer not null);
create table public.scan_requests (id uuid primary key, actor_id uuid not null, participant_id uuid not null, mode text not null, result jsonb not null, created_at timestamptz not null default now());
-- Realtime carries only an invalidation counter. Personal information and QR secrets never enter its payload.
create table public.event_signal (id boolean primary key default true check(id), version bigint not null default 0, updated_at timestamptz not null default now());
insert into public.event_signal values(true,0,now());
create function public.touch_updated() returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=clock_timestamp(); return new; end $$;
create trigger participant_updated before update on public.participants for each row execute function public.touch_updated();
create trigger exit_updated before update on public.exit_sessions for each row execute function public.touch_updated();
create function public.signal_change() returns trigger language plpgsql security definer set search_path=public as $$ begin update public.event_signal set version=version+1,updated_at=clock_timestamp() where id; return null; end $$;
create trigger participants_signal after insert or update or delete on public.participants for each row execute function public.signal_change();
create trigger exits_signal after insert or update or delete on public.exit_sessions for each row execute function public.signal_change();
create trigger settings_signal after update on public.settings for each row execute function public.signal_change();
create function public.is_staff() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.volunteers where id=auth.uid() and active) $$;
do $$ declare t text; begin foreach t in array array['settings','participants','qr_secrets','revoked_tokens','volunteers','volunteer_sessions','exit_sessions','audit_logs','registration_challenges','rate_limits','scan_requests','event_signal'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from anon, authenticated',t); execute format('grant all on public.%I to service_role',t); end loop; end $$;
grant usage,select on all sequences in schema public to service_role;
grant select on public.event_signal to authenticated;
create policy staff_signal on public.event_signal for select to authenticated using(public.is_staff());

create function public.valid_lease(p_actor uuid,p_lease text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.volunteer_sessions s join public.volunteers v on v.id=s.volunteer_id where v.id=p_actor and v.active and s.active and s.lease_hash=p_lease and s.last_seen_at>now()-interval '90 seconds' and s.exit_id=v.assigned_exit)
$$;
create function public.require_actor(p_actor uuid,p_lease text,p_admin boolean default false) returns public.volunteers language plpgsql security definer set search_path=public as $$
declare v public.volunteers; begin select * into v from public.volunteers where id=p_actor and active for share;
 if not found or (p_admin and v.role<>'admin') then raise exception 'Access denied'; end if;
 if v.role='volunteer' and not public.valid_lease(p_actor,p_lease) then raise exception 'Exit session expired'; end if; return v; end $$;
create function public.acquire_lease(p_actor uuid,p_hash text) returns void language plpgsql security definer set search_path=public as $$
declare v public.volunteers; begin
 perform pg_advisory_xact_lock(88101);
 select * into v from public.volunteers where id=p_actor and active;
 if not found then raise exception 'Access denied'; end if;
 if v.role='volunteer' then
 update public.volunteer_sessions set active=false,logout_at=now() where active and last_seen_at<=now()-interval '90 seconds';
 if exists(select 1 from public.volunteer_sessions where active and exit_id=v.assigned_exit) then raise exception 'Exit is already occupied. Wait for the previous session to expire.'; end if;
 insert into public.volunteer_sessions(volunteer_id,exit_id,lease_hash) values(v.id,v.assigned_exit,p_hash);
 end if;
 insert into public.audit_logs(actor_id,actor_type,action,metadata) values(v.id,v.role,'volunteer_login',jsonb_build_object('exit',v.assigned_exit)); end $$;
create function public.heartbeat(p_actor uuid,p_lease text) returns void language plpgsql security definer set search_path=public as $$ begin
 perform public.require_actor(p_actor,p_lease);
 update public.volunteer_sessions set last_seen_at=now() where volunteer_id=p_actor and lease_hash=p_lease and active;
end $$;
create function public.release_lease(p_actor uuid,p_lease text) returns void language plpgsql security definer set search_path=public as $$ begin
 update public.volunteer_sessions set active=false,logout_at=now() where volunteer_id=p_actor and lease_hash=p_lease and active;
 insert into public.audit_logs(actor_id,actor_type,action) select id,role,'volunteer_logout' from public.volunteers where id=p_actor;
end $$;
create function public.take_rate(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql security definer set search_path=public as $$
declare n integer; begin
 insert into public.rate_limits(key,window_start,count) values(p_key,now(),1)
 on conflict(key) do update set count=case when rate_limits.window_start<now()-make_interval(secs=>p_seconds) then 1 else rate_limits.count+1 end,
 window_start=case when rate_limits.window_start<now()-make_interval(secs=>p_seconds) then now() else rate_limits.window_start end returning count into n;
 return n<=p_limit; end $$;
create function public.otp_attempt(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.registration_challenges; begin
 update public.registration_challenges set attempts=attempts+1 where id=p_id and consumed_at is null and expires_at>now() and attempts<5 returning * into c;
 if not found then raise exception 'Verification expired or attempt limit reached. Request a new code.'; end if;
 return jsonb_build_object('phone',c.phone); end $$;
create function public.complete_registration(p_challenge uuid,p_hash text,p_encrypted text) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.registration_challenges; p public.participants; opened boolean; begin
 select registration_open into opened from public.settings where id for share;
 if not opened then raise exception 'Registration is closed'; end if;
 select * into c from public.registration_challenges where id=p_challenge for update;
 if not found or c.consumed_at is not null or c.expires_at<=now() or c.attempts=0 or c.attempts>5 then raise exception 'Verification expired or already used'; end if;
 insert into public.participants(name,phone,email,team_name,college_name,alternate_contact,phone_verified,qr_token_hash)
 values(c.details->>'name',c.phone,lower(c.details->>'email'),c.details->>'team_name',c.details->>'college_name',c.details->>'alternate_contact',true,p_hash) returning * into p;
 insert into public.qr_secrets values(p.id,p_encrypted);
 update public.registration_challenges set consumed_at=now(),details='{}' where id=c.id;
 insert into public.audit_logs(actor_type,participant_id,action) values('participant',p.id,'phone_verified'),('participant',p.id,'participant_registered'),('participant',p.id,'qr_generated');
 return jsonb_build_object('id',p.id,'participant_code',p.participant_code,'name',p.name,'team_name',p.team_name,'college_name',p.college_name);
end $$;

create function public.scan_participant(p_actor uuid,p_lease text,p_hash text,p_mode text,p_request uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.volunteers; p public.participants; s public.exit_sessions; previous public.scan_requests; result jsonb; moment timestamptz; action text; begin
 v:=public.require_actor(p_actor,p_lease);
 if v.role<>'volunteer' then raise exception 'Use an assigned gate volunteer account to scan'; end if;
 if p_mode not in ('auto','exit','return') then raise exception 'Invalid scan mode'; end if;
 -- Request lock provides idempotency even for concurrent retries.
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into p from public.participants where qr_token_hash=p_hash for update;
 if not found then
 if exists(select 1 from public.revoked_tokens where token_hash=p_hash) then raise exception 'QR code revoked'; end if;
 raise exception 'Participant not found'; end if;
 select * into previous from public.scan_requests where id=p_request;
 if found then if previous.actor_id<>p_actor or previous.participant_id<>p.id or previous.mode<>p_mode then raise exception 'Invalid request reuse'; end if; return previous.result; end if;
 if p.status='suspended' then raise exception 'Participant suspended'; end if;
 moment:=clock_timestamp();
 if p.last_scan_at is not null and moment-p.last_scan_at<interval '5 seconds' then return jsonb_build_object('action','duplicate','name',p.name,'participant_code',p.participant_code,'message','Duplicate scan ignored'); end if;
 if p_mode='exit' and p.status='outside' then raise exception 'Participant is already outside'; end if;
 if p_mode='return' and p.status='inside' then raise exception 'Participant is currently inside'; end if;
 if p.status='inside' then
 insert into public.exit_sessions(participant_id,exit_id,exited_at,exited_by) values(p.id,v.assigned_exit,moment,v.id) returning * into s;
 update public.participants set status='outside',last_scan_at=moment where id=p.id;
 action:='exit';
 else
 select * into s from public.exit_sessions where participant_id=p.id and returned_at is null for update;
 if not found then raise exception 'Participant state requires administrator attention'; end if;
 update public.exit_sessions set returned_at=moment,duration_seconds=greatest(0,extract(epoch from moment-exited_at)::integer),status='returned',return_method='qr',return_exit_id=v.assigned_exit,returned_by=v.id where id=s.id returning * into s;
 update public.participants set status='inside',last_scan_at=moment where id=p.id;
 action:='return'; end if;
 insert into public.audit_logs(actor_id,actor_type,participant_id,action,metadata) values(v.id,v.role,p.id,case when action='exit' then 'participant_exited' else 'participant_returned' end,jsonb_build_object('session',s.id,'exit',s.exit_id,'return_exit',s.return_exit_id));
 result:=jsonb_build_object('action',action,'name',p.name,'participant_code',p.participant_code,'team_name',p.team_name,'session',to_jsonb(s));
 insert into public.scan_requests values(p_request,v.id,p.id,p_mode,result,now()); return result; end $$;

create function public.manual_return(p_actor uuid,p_lease text,p_participant uuid) returns void language plpgsql security definer set search_path=public as $$
declare v public.volunteers; p public.participants; s public.exit_sessions; moment timestamptz; begin
 v:=public.require_actor(p_actor,p_lease);
 select * into p from public.participants where id=p_participant for update;
 if not found or p.status<>'outside' then raise exception 'Participant is currently inside or unavailable'; end if;
 moment:=clock_timestamp();
 update public.exit_sessions set returned_at=moment,duration_seconds=greatest(0,extract(epoch from moment-exited_at)::integer),status='returned',return_method='manual',returned_by=v.id,return_exit_id=v.assigned_exit where participant_id=p.id and returned_at is null returning * into s;
 if not found then raise exception 'No active exit session'; end if;
 update public.participants set status='inside',last_scan_at=moment where id=p.id;
 insert into public.audit_logs(actor_id,actor_type,participant_id,action,metadata) values(v.id,v.role,p.id,'participant_manually_returned',jsonb_build_object('session',s.id,'exit',s.exit_id,'return_exit',v.assigned_exit)); end $$;
create function public.mark_overdue() returns integer language plpgsql security definer set search_path=public as $$
declare n integer; begin
 with changed as (update public.exit_sessions set status='overdue' where status='active' and returned_at is null and exited_at<=now()-interval '30 minutes' returning *)
 insert into public.audit_logs(actor_type,participant_id,action,metadata) select 'system',participant_id,'participant_marked_overdue',jsonb_build_object('session',id,'exit',exit_id) from changed;
 get diagnostics n=row_count; return n; end $$;
create function public.change_registration(p_actor uuid,p_open boolean) returns void language plpgsql security definer set search_path=public as $$
begin perform public.require_actor(p_actor,null,true);
 update public.settings set registration_open=p_open where id and registration_open is distinct from p_open;
 if found then insert into public.audit_logs(actor_id,actor_type,action) values(p_actor,'admin',case when p_open then 'registration_opened' else 'registration_closed' end); end if; end $$;
create function public.change_qr(p_actor uuid,p_participant uuid,p_hash text,p_encrypted text) returns void language plpgsql security definer set search_path=public as $$
declare p public.participants; begin
 perform public.require_actor(p_actor,null,true);
 select * into p from public.participants where id=p_participant for update;
 if not found then raise exception 'Participant not found'; end if;
 if p.qr_token_hash is not null then insert into public.revoked_tokens values(p.qr_token_hash,p.id,now()) on conflict do nothing; end if;
 update public.participants set qr_token_hash=p_hash where id=p.id;
 delete from public.qr_secrets where participant_id=p.id;
 if p_hash is not null then insert into public.qr_secrets values(p.id,p_encrypted); end if;
 insert into public.audit_logs(actor_id,actor_type,participant_id,action) values(p_actor,'admin',p.id,case when p_hash is null then 'qr_revoked' else 'qr_regenerated' end); end $$;
create function public.set_volunteer_active(p_actor uuid,p_target uuid,p_active boolean) returns void language plpgsql security definer set search_path=public as $$
begin perform public.require_actor(p_actor,null,true);
 update public.volunteers set active=p_active where id=p_target and role='volunteer';
 if not found then raise exception 'Volunteer not found'; end if;
 if not p_active then update public.volunteer_sessions set active=false,logout_at=now() where volunteer_id=p_target and active; end if;
 insert into public.audit_logs(actor_id,actor_type,action,metadata) values(p_actor,'admin','volunteer_updated',jsonb_build_object('volunteer',p_target,'active',p_active)); end $$;
-- One statement supplies a consistent snapshot across participants, sessions and gate leases.
create function public.monitor_snapshot(p_actor uuid,p_lease text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.volunteers; result jsonb; begin
 v:=public.require_actor(p_actor,p_lease);
 select jsonb_build_object(
 'participants',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'participant_code',p.participant_code,'name',p.name,'phone',p.phone,'email',p.email,'team_name',p.team_name,'college_name',p.college_name,'alternate_contact',p.alternate_contact,'status',p.status,'created_at',p.created_at) order by p.participant_code) from public.participants p),'[]'::jsonb),
 'sessions',coalesce((select jsonb_agg(to_jsonb(s) order by s.exited_at) from public.exit_sessions s),'[]'::jsonb),
 'gates',coalesce((select jsonb_agg(jsonb_build_object('exit_id',s.exit_id,'last_seen_at',s.last_seen_at,'active',s.active)) from public.volunteer_sessions s where active),'[]'::jsonb),
 'staff',to_jsonb(v),'server_time',clock_timestamp(),
 'registration_open',(select registration_open from public.settings where id)) into result;
 return result; end $$;
-- All mutation functions are server-only. Never trust actor IDs supplied by a browser.
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on all functions in schema public to service_role;
grant execute on function public.is_staff() to authenticated;
alter publication supabase_realtime add table public.event_signal;
