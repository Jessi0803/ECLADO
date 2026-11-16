begin;

create table public.course_notifications (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  payer_id uuid not null,
  kind text not null check (kind in ('automatic','manual')),
  scheduled_start timestamptz,
  request_id uuid,
  registration_ids uuid[],
  message text,
  created_by uuid,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','sending','retry','sent','failed','unknown','skipped')),
  channel text check (channel in ('line','email')),
  attempts integer not null default 0,
  lease_token uuid,
  next_attempt_at timestamptz not null default now(),
  snapshot_hash text,
  result text,
  sent_at timestamptz,
  check (
    (kind = 'automatic' and scheduled_start is not null and request_id is null and registration_ids is null)
    or (kind = 'manual' and scheduled_start is null and request_id is not null and cardinality(registration_ids) > 0)
  )
);
create unique index course_notification_automatic_once
  on public.course_notifications (course_id, scheduled_start, payer_id) where kind = 'automatic';
create unique index course_notification_manual_once
  on public.course_notifications (course_id, request_id, payer_id) where kind = 'manual';
create index course_notification_due on public.course_notifications (next_attempt_at, id)
  where status in ('pending','retry','sending');
create index course_notification_history on public.course_notifications (course_id, created_at desc, id);
alter table public.course_notifications enable row level security;
revoke all on public.course_notifications from public, anon, authenticated, service_role;

create view public.course_notice_recipients as
select r.id as registration_id, r.course_id, o.payer_id, r.kind = 'delegated' as delegated
from public.course_registrations r
join public.course_orders o on o.id = r.order_id
where r.status = 'active'
  and ((r.kind = 'instructor_self' and o.payer_role = 'instructor') or o.status = 'paid');
revoke all on public.course_notice_recipients from public, anon, authenticated, service_role;

create function public.queue_manual_course_notification(
  p_course_id uuid, p_request_id uuid, p_registration_ids uuid[], p_message text
) returns integer language plpgsql security definer set search_path = '' as $$
declare queued integer;
begin
  if auth.uid() is null or not public.has_backoffice_permission('courses.manage')
    or not public.has_backoffice_permission('notifications.send') then
    raise exception '課程通知權限不足' using errcode = '42501';
  end if;
  if p_request_id is null or coalesce(cardinality(p_registration_ids),0) not between 1 and 1000
    or length(btrim(coalesce(p_message,''))) > 1000 then
    raise exception '請選取報名者，補充說明最多 1,000 字' using errcode = '22023';
  end if;
  perform 1 from public.courses where id = p_course_id and ends_at > clock_timestamp() for share;
  if not found then raise exception '此課程已結束或不存在' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_course_id::text || ':' || p_request_id::text, 0));
  select count(*)::integer into queued from public.course_notifications
    where course_id = p_course_id and kind = 'manual' and request_id = p_request_id;
  if queued > 0 then return queued; end if;

  insert into public.course_notifications(course_id,payer_id,kind,request_id,registration_ids,message,created_by)
  select p_course_id, r.payer_id, 'manual', p_request_id, array_agg(r.registration_id order by r.registration_id),
    nullif(btrim(p_message),''), auth.uid()
  from public.course_notice_recipients r
  where r.course_id = p_course_id and r.registration_id = any(p_registration_ids)
  group by r.payer_id;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

create function public.claim_course_notification(p_line_available boolean, p_email_from text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  notice public.course_notifications%rowtype;
  course public.courses%rowtype;
  token uuid;
  route text;
  target text;
  line_target text;
  email_target text;
  meeting_url text;
  has_delegate boolean;
  eligible_count integer;
  payload jsonb;
  fingerprint text;
begin
  -- A payer with multiple seats receives one reminder for the current start.
  insert into public.course_notifications(course_id,payer_id,kind,scheduled_start)
  select c.id, r.payer_id, 'automatic', c.starts_at
  from public.courses c join public.course_notice_recipients r on r.course_id = c.id
  where c.starts_at > now() and c.starts_at <= now() + interval '24 hours'
    and not exists (select 1 from public.course_notifications n
      where n.course_id = c.id and n.payer_id = r.payer_id and n.kind = 'automatic' and n.scheduled_start = c.starts_at)
  group by c.id, r.payer_id, c.starts_at
  order by c.starts_at, c.id, r.payer_id limit 250
  on conflict (course_id, scheduled_start, payer_id) where kind = 'automatic' do nothing;

  for notice in select * from public.course_notifications
    where status in ('pending','retry','sending') and next_attempt_at <= now()
    order by next_attempt_at, id limit 25 for update skip locked
  loop
    select * into course from public.courses where id = notice.course_id;
    select count(*), coalesce(bool_or(r.delegated),false) into eligible_count, has_delegate
    from public.course_notice_recipients r
    where r.course_id = notice.course_id and r.payer_id = notice.payer_id
      and (notice.kind = 'automatic' or r.registration_id = any(notice.registration_ids));

    if eligible_count = 0 or course.ends_at <= clock_timestamp() or
      (notice.kind = 'automatic' and (notice.scheduled_start <> course.starts_at or course.starts_at <= clock_timestamp())) then
      update public.course_notifications set status = case when notice.attempts > 0 then 'unknown' else 'skipped' end,
        result = 'no_longer_eligible', lease_token = null where id = notice.id;
      continue;
    end if;

    select nullif(btrim(p.line_user_id), ''),
      case when p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then p.email end
    into line_target, email_target from public.profiles p where p.id = notice.payer_id;
    route := coalesce(notice.channel, case when p_line_available and line_target is not null then 'line' else 'email' end);
    target := case when route = 'line' then line_target else email_target end;
    if target is null or (route = 'line' and not coalesce(p_line_available, false))
      or (route = 'email' and nullif(btrim(p_email_from),'') is null) then
      update public.course_notifications set status = case when notice.attempts > 0 then 'unknown' else 'failed' end,
        result = 'no_channel', lease_token = null where id = notice.id;
      continue;
    end if;

    select zoom_url into meeting_url from public.course_meeting_details where course_id = course.id;
    payload := jsonb_build_object('kind','course','name',course.name,'starts_at',course.starts_at,
      'ends_at',course.ends_at,'zoom_url',meeting_url,'message',notice.message,
      'delegated',has_delegate,'automatic',notice.kind = 'automatic');
    fingerprint := md5(jsonb_build_array(route,target,case when route = 'email' then p_email_from end,payload)::text);
    if notice.attempts >= 3 or (notice.snapshot_hash is not null and fingerprint <> notice.snapshot_hash) then
      update public.course_notifications set status = 'unknown', result = 'delivery_unconfirmed', lease_token = null where id = notice.id;
      continue;
    end if;

    token := gen_random_uuid();
    update public.course_notifications set status = 'sending', channel = route, attempts = attempts + 1,
      snapshot_hash = fingerprint, lease_token = token, next_attempt_at = now() + interval '2 minutes'
      where id = notice.id;
    return jsonb_build_object('id',notice.id,'lease_token',token,'channel',route,
      'target',target,'key',notice.id,'from',p_email_from,'payload',payload);
  end loop;
  return null;
end;
$$;

create function public.complete_course_notification(p_id uuid, p_token uuid, p_result text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare notice public.course_notifications%rowtype;
  next_status text;
  fallback boolean;
begin
  if p_result is null or p_result not in ('accepted','line_rejected','line_unavailable','line_server_error',
    'line_rate_limited','transient','ambiguous','permanent','configuration') then
    raise exception 'Invalid course notice result' using errcode = '22023';
  end if;
  select * into notice from public.course_notifications where id = p_id for update;
  if not found or notice.status <> 'sending' or notice.lease_token is distinct from p_token then return false; end if;
  fallback := notice.channel = 'line' and notice.attempts = 1 and p_result in ('line_rejected','line_unavailable');
  next_status := case
    when p_result = 'accepted' then 'sent'
    when fallback then 'retry'
    when p_result in ('permanent','configuration') then 'failed'
    when notice.attempts >= 3 and p_result in ('transient','line_rate_limited') then 'failed'
    when notice.attempts >= 3 then 'unknown'
    else 'retry' end;
  update public.course_notifications set status = next_status, result = p_result, lease_token = null,
    sent_at = case when next_status = 'sent' then now() end,
    channel = case when fallback then 'email' else channel end,
    attempts = case when fallback then 0 else attempts end,
    snapshot_hash = case when fallback then null else snapshot_hash end,
    next_attempt_at = now() + interval '1 minute' where id = p_id;
  return true;
end;
$$;

create function public.get_admin_course_notifications(p_course_id uuid, p_offset integer default 0, p_only_exceptions boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_backoffice_permission('courses.manage') then
    raise exception '課程管理權限不足' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc, n.id) from (
    select notice.id, notice.kind, notice.status, notice.channel, notice.result, notice.created_at, notice.sent_at,
      coalesce(nullif(p.name,''), '會員') as payer_name
    from public.course_notifications notice left join public.profiles p on p.id = notice.payer_id
    where notice.course_id = p_course_id
      and (not coalesce(p_only_exceptions, false) or notice.status in ('failed', 'unknown'))
    order by notice.created_at desc, notice.id
    limit 30 offset greatest(coalesce(p_offset,0),0)
  ) n), '[]'::jsonb);
end;
$$;

revoke all on function public.queue_manual_course_notification(uuid,uuid,uuid[],text),
  public.get_admin_course_notifications(uuid,integer,boolean), public.claim_course_notification(boolean,text),
  public.complete_course_notification(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.queue_manual_course_notification(uuid,uuid,uuid[],text),
  public.get_admin_course_notifications(uuid,integer,boolean) to authenticated;
grant execute on function public.claim_course_notification(boolean,text),
  public.complete_course_notification(uuid,uuid,text) to service_role;

-- The course list needs both registration and notification tables.
create or replace function public.get_admin_courses()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.has_backoffice_permission('courses.manage'), false) then
    raise exception 'Course management permission required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(c) || jsonb_build_object(
      'zoom_url', m.zoom_url,
      'open_case_count', (select count(*) from public.course_manual_cases mc
        join public.course_orders o on o.id = mc.order_id
        where o.course_id = c.id and mc.resolved_at is null),
      'notification_exception_count', (select count(*) from public.course_notifications n
        where n.course_id = c.id and n.status in ('failed', 'unknown'))
    ) order by c.starts_at, c.id)
    from public.courses c left join public.course_meeting_details m on m.course_id = c.id
  ), '[]'::jsonb);
end;
$$;

commit;
