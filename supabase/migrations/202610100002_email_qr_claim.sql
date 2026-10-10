-- Email OTP replaces phone OTP for new QR claims. Preserve all historical verification flags.
-- Old pending challenges have no method and must request a fresh email code.
alter table public.registration_challenges add column verification_method text
 check (verification_method in ('email','phone'));

create or replace function public.complete_qr_claim(p_challenge uuid,p_binding text) returns jsonb
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
   if c.verification_method is distinct from 'email' or c.qr_id is null or c.verified_at is null or c.expires_at<=now() then raise exception 'Verification expired or unverified'; end if;
   select * into q from public.qr_inventory where id=c.qr_id for update;
   if q.status='revoked' then raise exception 'QR code revoked'; end if;
   if q.status<>'unassigned' then raise exception 'QR already claimed'; end if;
   insert into public.participants(name,phone,email,team_name,college_name,alternate_contact,phone_verified,email_verified,qr_token_hash)
   values(c.details->>'name',c.phone,lower(c.details->>'email'),c.details->>'team_name',c.details->>'college_name',c.details->>'alternate_contact',false,true,q.token_hash) returning * into p;
   insert into public.qr_secrets select p.id,encrypted_token from public.qr_inventory_secrets where qr_id=q.id;
   update public.qr_inventory set status='claimed',participant_id=p.id,claimed_at=now() where id=q.id;
   update public.registration_challenges set consumed_at=now(),participant_id=p.id,details='{}' where id=c.id;
   insert into public.audit_logs(actor_type,participant_id,action,metadata) values
   ('participant',p.id,'email_verified','{}'),('participant',p.id,'participant_registered','{}'),
   ('participant',p.id,'qr_claimed',jsonb_build_object('qr',q.id,'serial',q.serial_number));
 end if;
 return jsonb_build_object('id',p.id,'participant_code',p.participant_code,'name',p.name,'team_name',p.team_name,'college_name',p.college_name);
end $$;


revoke execute on function public.complete_qr_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.complete_qr_claim(uuid,text) to service_role;
