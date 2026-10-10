-- Additive inventory; historical participants and attendance are untouched.
create sequence public.qr_serial_number;
create table public.qr_batches (
 id uuid primary key, created_by uuid not null references public.volunteers(id),
 quantity integer not null check(quantity between 1 and 1000),
 created_at timestamptz not null default now()
);
create table public.qr_inventory (
 id uuid primary key default gen_random_uuid(),
 batch_id uuid not null references public.qr_batches(id),
 serial_number text not null unique default ('FARL-QR-' || lpad(nextval('public.qr_serial_number')::text, greatest(4,length(currval('public.qr_serial_number')::text)), '0')),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'unassigned' check(status in ('unassigned','claimed','revoked')),
 participant_id uuid unique references public.participants(id),
 created_at timestamptz not null default now(), claimed_at timestamptz, revoked_at timestamptz,
 check((participant_id is null) = (claimed_at is null)),
 check((status='unassigned' and participant_id is null and revoked_at is null)
    or (status='claimed' and participant_id is not null and revoked_at is null)
    or (status='revoked' and revoked_at is not null))
);
create index qr_inventory_batch_status on public.qr_inventory(batch_id,status);
create table public.qr_inventory_secrets (
 qr_id uuid primary key references public.qr_inventory(id), encrypted_token text not null
);
alter table public.registration_challenges
 add column qr_id uuid references public.qr_inventory(id),
 add column binding_hash text,
 add column verified_at timestamptz,
 add column participant_id uuid references public.participants(id);
create index challenge_qr on public.registration_challenges(qr_id);
-- Avoid the original lpad truncation after participant 9999.
alter table public.participants alter column participant_code set default
 ('FARL-' || lpad(nextval('public.participant_number')::text, greatest(4,length(currval('public.participant_number')::text)), '0'));

create function public.generate_qr_batch(p_actor uuid,p_batch uuid,p_codes jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare b public.qr_batches; item jsonb; q uuid; n integer; begin
 perform public.require_actor(p_actor,null,true);
 perform pg_advisory_xact_lock(hashtextextended(p_batch::text,1));
 select * into b from public.qr_batches where id=p_batch;
 if found then
   if b.created_by<>p_actor or b.quantity<>jsonb_array_length(p_codes) then raise exception 'Invalid request reuse'; end if;
   return b.id;
 end if;
 n:=jsonb_array_length(p_codes);
 if n is null or n<1 or n>1000 then raise exception 'Invalid batch quantity'; end if;
 insert into public.qr_batches(id,created_by,quantity) values(p_batch,p_actor,n);
 for item in select value from jsonb_array_elements(p_codes) loop
   insert into public.qr_inventory(batch_id,token_hash) values(p_batch,item->>'hash') returning id into q;
   insert into public.qr_inventory_secrets values(q,item->>'encrypted');
 end loop;
 insert into public.audit_logs(actor_id,actor_type,action,metadata)
 values(p_actor,'admin','qr_batch_generated',jsonb_build_object('batch',p_batch,'quantity',n));
 return p_batch;
end $$;

-- Retire registration-first issuance, including callers using an older app version.
create or replace function public.complete_registration(p_challenge uuid,p_hash text,p_encrypted text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin raise exception 'Use an assigned ID card QR to register'; end $$;

create function public.complete_qr_claim(p_challenge uuid,p_binding text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.registration_challenges; q public.qr_inventory; p public.participants; opened boolean; begin
 select registration_open into opened from public.settings where id for share;
 select * into c from public.registration_challenges where id=p_challenge for update;
 if not found or c.binding_hash is null or c.binding_hash is distinct from p_binding then raise exception 'Verification expired or invalid'; end if;
 -- A lost success response can be retried with the same HTTP-only binding.
 if c.consumed_at is not null and c.participant_id is not null then
   select * into p from public.participants where id=c.participant_id;
 else
   if not opened then raise exception 'Registration is closed'; end if;
   if c.qr_id is null or c.verified_at is null or c.expires_at<=now() then raise exception 'Verification expired or unverified'; end if;
   select * into q from public.qr_inventory where id=c.qr_id for update;
   if q.status='revoked' then raise exception 'QR code revoked'; end if;
   if q.status<>'unassigned' then raise exception 'QR already claimed'; end if;
   insert into public.participants(name,phone,email,team_name,college_name,alternate_contact,phone_verified,email_verified,qr_token_hash)
   values(c.details->>'name',c.phone,lower(c.details->>'email'),c.details->>'team_name',c.details->>'college_name',c.details->>'alternate_contact',true,false,q.token_hash) returning * into p;
   insert into public.qr_secrets select p.id,encrypted_token from public.qr_inventory_secrets where qr_id=q.id;
   update public.qr_inventory set status='claimed',participant_id=p.id,claimed_at=now() where id=q.id;
   update public.registration_challenges set consumed_at=now(),participant_id=p.id,details='{}' where id=c.id;
   insert into public.audit_logs(actor_type,participant_id,action,metadata) values
   ('participant',p.id,'phone_verified','{}'),('participant',p.id,'participant_registered','{}'),
   ('participant',p.id,'qr_claimed',jsonb_build_object('qr',q.id,'serial',q.serial_number));
 end if;
 return jsonb_build_object('id',p.id,'participant_code',p.participant_code,'name',p.name,'team_name',p.team_name,'college_name',p.college_name);
end $$;

-- Reuse legacy QR revocation, updating inventory in the same transaction.
alter function public.change_qr(uuid,uuid,text,text) rename to change_legacy_qr;
create function public.change_qr(p_actor uuid,p_participant uuid,p_hash text,p_encrypted text) returns void
language plpgsql security definer set search_path=public as $$
declare q public.qr_inventory; begin
 perform public.require_actor(p_actor,null,true);
 select * into q from public.qr_inventory where participant_id=p_participant for update;
 if found then
   if p_hash is not null then raise exception 'Use an assigned ID card QR; printed codes cannot be regenerated'; end if;
   perform 1 from public.participants where id=p_participant for update;
   update public.qr_inventory set status='revoked',revoked_at=coalesce(revoked_at,now()) where id=q.id;
 end if;
 perform public.change_legacy_qr(p_actor,p_participant,p_hash,p_encrypted);
end $$;
create function public.revoke_inventory_qr(p_actor uuid,p_qr uuid) returns void
language plpgsql security definer set search_path=public as $$
declare q public.qr_inventory; begin
 perform public.require_actor(p_actor,null,true);
 select * into q from public.qr_inventory where id=p_qr for update;
 if not found then raise exception 'QR not found'; end if;
 if q.status='revoked' then return; end if;
 if q.participant_id is not null then perform public.change_qr(p_actor,q.participant_id,null,null);
 else update public.qr_inventory set status='revoked',revoked_at=now() where id=q.id;
 end if;
 insert into public.audit_logs(actor_id,actor_type,participant_id,action,metadata)
 values(p_actor,'admin',q.participant_id,'inventory_qr_revoked',jsonb_build_object('qr',q.id,'serial',q.serial_number));
end $$;

alter function public.monitor_snapshot(uuid,text) rename to legacy_monitor_snapshot;
create function public.monitor_snapshot(p_actor uuid,p_lease text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; begin
 result:=public.legacy_monitor_snapshot(p_actor,p_lease);
 result:=jsonb_set(result,'{participants}',coalesce((select jsonb_agg(value || jsonb_build_object('phone_verified',p.phone_verified,'email_verified',p.email_verified,'qr_serial',q.serial_number))
 from jsonb_array_elements(result->'participants') e(value) join public.participants p on p.id=(value->>'id')::uuid left join public.qr_inventory q on q.participant_id=p.id),'[]'::jsonb));
 if result->'staff'->>'role'='admin' then
   result:=result || jsonb_build_object('qr_counts',(select jsonb_build_object('total',count(*),'unassigned',count(*) filter(where status='unassigned'),'claimed',count(*) filter(where status='claimed'),'revoked',count(*) filter(where status='revoked')) from public.qr_inventory));
 else
   -- Gate operations need identity and emergency contacts, not participant emails.
   result:=jsonb_set(result,'{participants}',coalesce((select jsonb_agg(value || jsonb_build_object('email','')) from jsonb_array_elements(result->'participants')),'[]'::jsonb));
 end if;
 return result;
end $$;
create trigger inventory_signal after insert or update on public.qr_inventory for each statement execute function public.signal_change();
do $$ declare t text; begin foreach t in array array['qr_batches','qr_inventory','qr_inventory_secrets'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop; end $$;
grant usage,select on sequence public.qr_serial_number to service_role;

-- QR and manual returns share the same row-locked transition and audit operation.
create function public.finish_participant_return(p_actor uuid,p_lease text,p_participant uuid,p_method text)
returns public.exit_sessions language plpgsql security definer set search_path=public as $$
declare v public.volunteers; p public.participants; s public.exit_sessions; moment timestamptz; begin
 v:=public.require_actor(p_actor,p_lease);
 if p_method not in ('qr','manual') or (p_method='qr' and v.role<>'volunteer') then raise exception 'Access denied'; end if;
 select * into p from public.participants where id=p_participant for update;
 if not found or p.status<>'outside' then raise exception 'Participant is currently inside or unavailable'; end if;
 moment:=clock_timestamp();
 update public.exit_sessions set returned_at=moment,duration_seconds=greatest(0,extract(epoch from moment-exited_at)::integer),status='returned',return_method=p_method,returned_by=v.id,return_exit_id=v.assigned_exit where participant_id=p.id and returned_at is null returning * into s;
 if not found then raise exception 'No active exit session'; end if;
 update public.participants set status='inside',last_scan_at=moment where id=p.id;
 insert into public.audit_logs(actor_id,actor_type,participant_id,action,metadata) values(v.id,v.role,p.id,case when p_method='manual' then 'participant_manually_returned' else 'participant_returned' end,jsonb_build_object('session',s.id,'exit',s.exit_id,'return_exit',v.assigned_exit));
 return s;
end $$;
create or replace function public.manual_return(p_actor uuid,p_lease text,p_participant uuid) returns void
language plpgsql security definer set search_path=public as $$
begin perform public.finish_participant_return(p_actor,p_lease,p_participant,'manual'); end $$;

create or replace function public.scan_participant(p_actor uuid,p_lease text,p_hash text,p_mode text,p_request uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.volunteers; p public.participants; s public.exit_sessions; previous public.scan_requests; result jsonb; moment timestamptz; action text; begin
 v:=public.require_actor(p_actor,p_lease);
 if v.role<>'volunteer' then raise exception 'Use an assigned gate volunteer account to scan'; end if;
 if p_mode not in ('auto','exit','return') then raise exception 'Invalid scan mode'; end if;
 -- Request lock provides idempotency even for concurrent retries.
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into p from public.participants where qr_token_hash=p_hash for update;
 if not found then
 if exists(select 1 from public.revoked_tokens where token_hash=p_hash) or exists(select 1 from public.qr_inventory where token_hash=p_hash and status='revoked') then raise exception 'QR code revoked'; end if;
 if exists(select 1 from public.qr_inventory where token_hash=p_hash and status='unassigned') then raise exception 'QR not yet claimed. Register the ID card first'; end if;
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
 s:=public.finish_participant_return(p_actor,p_lease,p.id,'qr');
 action:='return'; end if;
 if action='exit' then insert into public.audit_logs(actor_id,actor_type,participant_id,action,metadata) values(v.id,v.role,p.id,case when action='exit' then 'participant_exited' else 'participant_returned' end,jsonb_build_object('session',s.id,'exit',s.exit_id,'return_exit',s.return_exit_id)); end if;
 result:=jsonb_build_object('action',action,'name',p.name,'participant_code',p.participant_code,'team_name',p.team_name,'session',to_jsonb(s));
 insert into public.scan_requests values(p_request,v.id,p.id,p_mode,result,now()); return result; end $$;


revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on all functions in schema public to service_role;
-- Only the wrapper can change an inventory-backed participant's credential.
revoke execute on function public.change_legacy_qr(uuid,uuid,text,text) from service_role;
grant execute on function public.is_staff() to authenticated;
