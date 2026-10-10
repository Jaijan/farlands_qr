alter table public.participants
  drop constraint if exists participants_phone_verified_check;
alter table public.participants
  add column if not exists email_verified boolean not null default false;

create or replace function public.complete_registration(
  p_challenge uuid,
  p_hash text,
  p_encrypted text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.registration_challenges;
  p public.participants;
  opened boolean;
begin
  select registration_open into opened from public.settings where id for share;
  if not opened then raise exception 'Registration is closed'; end if;

  select * into c from public.registration_challenges where id = p_challenge for update;
  if not found or c.consumed_at is not null or c.expires_at <= now()
     or c.attempts = 0 or c.attempts > 5 then
    raise exception 'Verification expired or already used';
  end if;

  insert into public.participants(
    name, phone, email, team_name, college_name, alternate_contact,
    phone_verified, email_verified, qr_token_hash
  )
  values(
    c.details->>'name', c.phone, lower(c.details->>'email'),
    c.details->>'team_name', c.details->>'college_name',
    c.details->>'alternate_contact', false, true, p_hash
  )
  returning * into p;

  insert into public.qr_secrets values(p.id, p_encrypted);
  update public.registration_challenges set consumed_at = now(), details = '{}' where id = c.id;
  insert into public.audit_logs(actor_type, participant_id, action)
  values
    ('participant', p.id, 'email_verified'),
    ('participant', p.id, 'participant_registered'),
    ('participant', p.id, 'qr_generated');

  return jsonb_build_object(
    'id', p.id,
    'participant_code', p.participant_code,
    'name', p.name,
    'team_name', p.team_name,
    'college_name', p.college_name
  );
end
$$;
