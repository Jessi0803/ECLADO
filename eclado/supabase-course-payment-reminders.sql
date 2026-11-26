-- Apply after supabase-course-payment-resume.sql. Reuse the existing course notice delivery/ledger.
begin;
alter table public.course_notifications add column if not exists order_id uuid references public.course_orders(id);
-- Replace both kind-dependent checks without assuming PostgreSQL's generated names.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.course_notifications'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%kind%' loop
  execute format('alter table public.course_notifications drop constraint %I',c.conname);
 end loop;
end; $$;
alter table public.course_notifications add constraint course_notification_kind check(kind in('automatic','manual','payment_first','payment_final'));
alter table public.course_notifications add constraint course_notification_shape check(
 (kind='automatic' and scheduled_start is not null and request_id is null and registration_ids is null and order_id is null)
 or (kind='manual' and scheduled_start is null and request_id is not null and cardinality(registration_ids)>0 and order_id is null)
 or (kind in('payment_first','payment_final') and order_id is not null and scheduled_start is null and request_id is null and registration_ids is null));
create unique index course_payment_reminder_once on public.course_notifications(order_id,kind) where kind in('payment_first','payment_final');

create function public.expire_course_registrations() returns integer language plpgsql security definer set search_path='' as $$
declare item record; changed integer; total integer:=0;
begin
 for item in select c.id from public.courses c where exists(select 1 from public.course_orders o
   join public.course_registrations r on r.order_id=o.id where o.course_id=c.id and o.status='pending' and r.status='pending'
   and least(o.payment_due_at,c.starts_at)<=clock_timestamp()) order by c.id limit 100 for update of c skip locked loop
  update public.course_registrations r set status='cancelled',cancelled_at=clock_timestamp(),cancel_reason='付款期限已過'
   from public.course_orders o,public.courses c where r.order_id=o.id and o.course_id=c.id and c.id=item.id
    and o.status='pending' and r.status='pending' and least(o.payment_due_at,c.starts_at)<=clock_timestamp();
  get diagnostics changed=row_count; total:=total+changed;
 end loop;
 return total;
end; $$;

create function public.claim_course_payment_reminder(p_line_available boolean,p_email_from text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.course_notifications%rowtype; order_record public.course_orders%rowtype; course_record public.courses%rowtype;
 target text; route text; token uuid; payload jsonb; fingerprint text; last_sent timestamptz; due timestamptz; names jsonb;
begin
 perform public.expire_course_registrations();
 -- Only insert reminders already due. A late worker coalesces the first/final stages.
 insert into public.course_notifications(course_id,payer_id,kind,order_id)
 select c.id,o.payer_id,stage.kind,o.id from public.course_orders o join public.courses c on c.id=o.course_id
 cross join lateral (select case
  when least(o.payment_due_at,c.starts_at)-o.created_at<interval '24 hours' then 'payment_final'
  when clock_timestamp()>=least(o.payment_due_at,c.starts_at)-interval '24 hours' then 'payment_final'
  else 'payment_first' end as kind) stage
 where o.status='pending' and c.published and (c.publish_at is null or c.publish_at<=clock_timestamp())
 and least(o.payment_due_at,c.starts_at)>clock_timestamp()
 and exists(select 1 from public.course_registrations r where r.order_id=o.id and r.status='pending')
 and ((stage.kind='payment_first' and o.created_at+interval '24 hours'<=clock_timestamp())
  or (stage.kind='payment_final' and case
    when least(o.payment_due_at,c.starts_at)-o.created_at<interval '24 hours' then o.created_at+interval '1 hour'
    else least(o.payment_due_at,c.starts_at)-interval '24 hours' end<=clock_timestamp()))
 and not exists(select 1 from public.course_notifications old where old.order_id=o.id and old.kind=stage.kind)
 order by o.created_at,o.id limit 250
 on conflict(order_id,kind) where kind in('payment_first','payment_final') do nothing;

 for n in select * from public.course_notifications where kind in('payment_first','payment_final')
  and status in('pending','retry','sending') and next_attempt_at<=clock_timestamp()
  order by next_attempt_at,id limit 25 for update skip locked loop
  select * into course_record from public.courses where id=n.course_id for share;
  select * into order_record from public.course_orders where id=n.order_id for share;
  due:=least(order_record.payment_due_at,course_record.starts_at);
  select jsonb_agg(r.participant_name order by r.created_at,r.id) into names
   from public.course_registrations r where r.order_id=order_record.id and r.status='pending';
  if order_record.status<>'pending' or not course_record.published or (course_record.publish_at is not null and course_record.publish_at>clock_timestamp())
    or due<=clock_timestamp() or names is null then
   update public.course_notifications set status=case when attempts>0 then 'unknown' else 'skipped' end,result='no_longer_eligible',lease_token=null where id=n.id;
   continue;
  end if;
  if n.kind='payment_first' and clock_timestamp()>=due-interval '24 hours' then
   update public.course_notifications set status=case when attempts>0 then 'unknown' else 'skipped' end,result='merged_final',lease_token=null where id=n.id;
   continue;
  end if;
  select max(sent_at) into last_sent from public.course_notifications where order_id=order_record.id and kind='payment_first' and status='sent';
  -- Use actual sending time, not enqueue time, for minimum spacing.
  if n.kind='payment_final' and last_sent>clock_timestamp()-interval '24 hours' then
   update public.course_notifications set next_attempt_at=last_sent+interval '24 hours' where id=n.id;
   continue;
  end if;
  -- Re-evaluate dates after postponements; do not send a previously queued final reminder too early.
  if n.kind='payment_final' and clock_timestamp()<(case when due-order_record.created_at<interval '24 hours'
    then order_record.created_at+interval '1 hour' else due-interval '24 hours' end) then
   update public.course_notifications set next_attempt_at=case when due-order_record.created_at<interval '24 hours'
    then order_record.created_at+interval '1 hour' else due-interval '24 hours' end where id=n.id;
   continue;
  end if;
  select coalesce(n.channel,case when p_line_available and nullif(btrim(p.line_user_id),'') is not null then 'line' else 'email' end)
    into route from public.profiles p where p.id=order_record.payer_id;
  select case when route='line' then nullif(btrim(p.line_user_id),'')
    when p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then p.email end into target from public.profiles p where p.id=order_record.payer_id;
  if target is null or (route='line' and not coalesce(p_line_available,false)) or (route='email' and nullif(btrim(p_email_from),'') is null) then
   update public.course_notifications set status=case when attempts>0 then 'unknown' else 'failed' end,result='no_channel',lease_token=null where id=n.id;
   continue;
  end if;
  payload:=jsonb_build_object('kind','course_payment','name',course_record.name,'course_id',course_record.id,'order_id',order_record.id,
   'starts_at',course_record.starts_at,'payment_due_at',due,'total_twd',order_record.total_twd,'participants',names,'final',n.kind='payment_final');
  fingerprint:=md5(jsonb_build_array(route,target,case when route='email' then p_email_from end,payload)::text);
  if n.attempts>=3 or (n.snapshot_hash is not null and (n.snapshot_hash<>fingerprint or n.created_at<=clock_timestamp()-interval '23 hours')) then
   update public.course_notifications set status='unknown',result='delivery_unconfirmed',lease_token=null where id=n.id;
   continue;
  end if;
  token:=gen_random_uuid();
  update public.course_notifications set status='sending',channel=route,attempts=attempts+1,snapshot_hash=fingerprint,
   lease_token=token,next_attempt_at=clock_timestamp()+interval '2 minutes' where id=n.id;
  return jsonb_build_object('id',n.id,'lease_token',token,'channel',route,'target',target,'key',n.id,'from',p_email_from,'payload',payload);
 end loop;
 return null;
end; $$;

-- Keep class reminders/manual notifications unchanged and in the same delivery worker.
create function public.claim_class_course_notification(p_line_available boolean, p_email_from text)
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
    where kind in ('automatic','manual') and status in ('pending','retry','sending') and next_attempt_at <= now()
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

create or replace function public.claim_course_notification(p_line_available boolean,p_email_from text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 -- Payment reminders are separately enabled by the new worker; old workers only receive class notices.
 return public.claim_class_course_notification(p_line_available,p_email_from);
end; $$;
revoke all on function public.expire_course_registrations(),public.claim_course_payment_reminder(boolean,text),public.claim_class_course_notification(boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.expire_course_registrations(),public.claim_course_payment_reminder(boolean,text) to service_role;
notify pgrst,'reload schema';
commit;
