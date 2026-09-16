-- Durable administrator email notification state for new professional applications.
-- Run once in the Supabase SQL Editor before deploying the matching frontend/API.

begin;

alter table public.professional_applications
  add column if not exists admin_notification_sent_at timestamptz,
  add column if not exists admin_notification_attempts integer not null default 0,
  add column if not exists admin_notification_last_attempt_at timestamptz,
  add column if not exists admin_notification_error text;

alter table public.professional_applications
  drop constraint if exists professional_applications_admin_notification_attempts_check;

alter table public.professional_applications
  add constraint professional_applications_admin_notification_attempts_check
  check (admin_notification_attempts >= 0);

create or replace function public.claim_professional_application_admin_notification(
  p_application_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.professional_applications%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  update public.professional_applications application
  set admin_notification_attempts = application.admin_notification_attempts + 1,
      admin_notification_last_attempt_at = now(),
      admin_notification_error = null
  where application.id = p_application_id
    and application.user_id = p_user_id
    and application.status = 'pending'
    and application.admin_notification_sent_at is null
    and (
      application.admin_notification_last_attempt_at is null
      or application.admin_notification_last_attempt_at <= now() - interval '2 minutes'
    )
  returning application.* into claimed;

  if claimed.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', claimed.id,
    'created_at', claimed.created_at,
    'attempts', claimed.admin_notification_attempts
  );
end;
$$;

create or replace function public.complete_professional_application_admin_notification(
  p_application_id uuid,
  p_sent boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  update public.professional_applications application
  set admin_notification_sent_at = case when p_sent then now() else null end,
      admin_notification_error = case
        when p_sent then null
        else left(coalesce(nullif(btrim(p_error), ''), 'Email delivery failed'), 1000)
      end
  where application.id = p_application_id
    and application.admin_notification_sent_at is null
  returning application.id into updated_id;

  return updated_id is not null;
end;
$$;

revoke all on function public.claim_professional_application_admin_notification(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_professional_application_admin_notification(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.claim_professional_application_admin_notification(uuid, uuid)
  to service_role;
grant execute on function public.complete_professional_application_admin_notification(uuid, boolean, text)
  to service_role;

comment on function public.claim_professional_application_admin_notification(uuid, uuid) is
  'Atomically reserves an administrator email attempt for an authenticated user own pending application.';
comment on function public.complete_professional_application_admin_notification(uuid, boolean, text) is
  'Records administrator email delivery or a bounded delivery error for a professional application.';

notify pgrst, 'reload schema';

commit;
