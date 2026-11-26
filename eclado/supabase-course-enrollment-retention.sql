-- Apply after course-payment-resume and course-payment-reminders.
-- Retain enrollment until customer-requested staff cancellation, independent of payment expiry.
begin;
alter table public.course_orders drop constraint course_orders_status_check;
alter table public.course_orders add constraint course_orders_status_check check(status in('free','pending','paid','failed','review','hold','cancelled'));
alter table public.course_manual_cases drop constraint course_manual_cases_kind_check;
alter table public.course_manual_cases add constraint course_manual_cases_kind_check
 check(kind in('cancelled_paid_registration','payment_exception','after_course','cancelled_unpaid_registration'));

create or replace function public.create_course_registration(p_course_id uuid, p_request_id uuid, p_self boolean,
  p_participants jsonb, p_expected_price integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  course public.courses%rowtype;
  member public.profiles%rowtype;
  saved public.course_orders%rowtype;
  entry jsonb;
  people jsonb := '[]';
  student_id uuid;
  full_name text;
  family_name text;
  given_name text;
  paid_count integer;
  submitted jsonb := jsonb_build_array(p_self, p_participants, p_expected_price);
  deadline timestamptz;
begin
  if actor is null then raise exception '請先登入' using errcode = '42501'; end if;
  if p_request_id is null or p_self is null or jsonb_typeof(p_participants) is distinct from 'array' then
    raise exception '報名資料格式有誤' using errcode = '22023';
  end if;
  if jsonb_array_length(p_participants) > 30 then
    raise exception '每筆最多代報 30 位參加者' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_request_id::text, 0));
  select * into saved from public.course_orders where payer_id = actor and request_id = p_request_id;
  if found then
    if saved.course_id is distinct from p_course_id or saved.request_payload is distinct from submitted then
      raise exception '報名內容已變更，請重新確認' using errcode = '22023';
    end if;
    return public.course_order_summary(saved);
  end if;

  select * into course from public.courses where id = p_course_id for update;
  if not found or not (course.published and (course.publish_at is null or course.publish_at <= clock_timestamp())) or course.starts_at <= clock_timestamp() or (course.registration_opens_at is not null and course.registration_opens_at > clock_timestamp()) then
    raise exception '課程已停止報名' using errcode = '22023';
  end if;
  select * into member from public.profiles where id = actor for share;
  if member.role is null or member.role not in ('pro','instructor') then
    raise exception '此會員身分無法報名' using errcode = '42501';
  end if;
  if p_expected_price is distinct from course.price_twd then
    raise exception '課程費用已更新，請重新載入確認' using errcode = '22023';
  end if;
  paid_count := jsonb_array_length(p_participants);
  if (member.role = 'pro' and (not p_self or paid_count <> 0)) or
    (member.role = 'instructor' and not p_self and paid_count = 0) then
    raise exception '請選擇有效的報名方式' using errcode = '22023';
  end if;
  if member.role = 'pro' then paid_count := 1; end if;
  if paid_count > 0 and (course.price_twd = 0 or course.price_twd * paid_count > 9999999) then
    raise exception '課程付款金額超出可受理範圍，請聯繫客服' using errcode = '22023';
  end if;

  -- Unpaid/overdue enrollments remain registered; only staff can cancel on request.
  if p_self and exists (select 1 from public.course_registrations r where r.course_id = course.id
    and r.member_id = actor and r.status in ('pending','active')) then
    raise exception '您已報名此課程，請查看既有報名' using errcode = '23505';
  end if;
  for entry in select value from jsonb_array_elements(p_participants) loop
    student_id := null;
    if jsonb_typeof(entry) is distinct from 'object' then
      raise exception '參加者資料格式有誤' using errcode = '22023';
    end if;
    if entry ? 'binding_id' then
      select s.id, btrim(s.name) into student_id, full_name
      from public.instructor_student_bindings b join public.profiles s on s.id = b.student_id
      where b.id::text = entry->>'binding_id' and b.instructor_id = actor and b.ended_at is null
      for share of b, s;
      if student_id is null or student_id = actor then
        raise exception '學生已解除綁定或無法選取' using errcode = '22023';
      end if;
      if exists (select 1 from public.course_registrations r where r.course_id = course.id
        and r.member_id = student_id and r.status in ('pending','active')) or
        people @> jsonb_build_array(jsonb_build_object('member_id', student_id)) then
        raise exception '選取的學生已在此課程名單中' using errcode = '23505';
      end if;
    else
      family_name := btrim(coalesce(entry->>'family_name',''));
      given_name := btrim(coalesce(entry->>'given_name',''));
      if jsonb_typeof(entry->'family_name') is distinct from 'string'
        or jsonb_typeof(entry->'given_name') is distinct from 'string'
        or char_length(family_name) not between 1 and 60 or char_length(given_name) not between 1 and 60 then
        raise exception '請填寫每位參加者的姓與名' using errcode = '22023';
      end if;
      full_name := family_name || case when family_name ~ '[A-Za-z]$' and given_name ~ '^[A-Za-z]' then ' ' else '' end || given_name;
    end if;
    if coalesce(char_length(full_name), 0) not between 1 and 121 then
      raise exception '參加者姓名不完整，請手動輸入' using errcode = '22023';
    end if;
    people := people || jsonb_build_array(jsonb_build_object('member_id', student_id, 'name', full_name));
  end loop;

  full_name := nullif(btrim(member.name), '');
  if full_name is null then raise exception '請先在會員資料填寫姓名' using errcode = '22023'; end if;
  deadline := course.starts_at;
  if paid_count > 0 and deadline < clock_timestamp() + interval '1 minute' then
    raise exception '課程即將開始，已停止付費報名' using errcode = '22023';
  end if;
  insert into public.course_orders (course_id, payer_id, payer_name, payer_role, request_id, request_payload,
    course_name, unit_price_twd, paid_seats, total_twd, status, payment_due_at)
  values (course.id, actor, full_name, member.role, p_request_id, submitted, course.name,
    course.price_twd, paid_count, course.price_twd * paid_count,
    case when paid_count = 0 then 'free' else 'pending' end, deadline)
  returning * into saved;
  if p_self then
    insert into public.course_registrations (course_id, order_id, member_id, participant_name, kind, status, confirmed_at)
    values (course.id, saved.id, actor, full_name, case when member.role = 'pro' then 'pro_self' else 'instructor_self' end,
      case when member.role = 'pro' then 'pending' else 'active' end, case when member.role = 'instructor' then now() end);
  end if;
  insert into public.course_registrations (course_id, order_id, member_id, participant_name, kind, status)
  select course.id, saved.id, (item->>'member_id')::uuid, item->>'name', 'delegated', 'pending'
    from jsonb_array_elements(people) item;
  return public.course_order_summary(saved);
end;
$$;

create or replace function public.course_order_summary(p_order public.course_orders)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p_order.id,'course_id',p_order.course_id,'course_name',p_order.course_name,
  'total_twd',p_order.total_twd,'status',case when p_order.status='pending' and least(p_order.payment_due_at,c.starts_at)<=now() then 'expired' else p_order.status end,
  'payment_due_at',least(p_order.payment_due_at,c.starts_at),'paid_at',p_order.paid_at,
  'payment_method',a.payment_method,'payment_link_expires_at',a.link_expires_at,
  'payment_attempt_state',a.state,
  'atm_account',case when a.payment_method='atm' and a.state='pending' and p_order.status='pending'
    and c.published and least(a.link_expires_at,p_order.payment_due_at,c.starts_at)>now() then a.atm_account end,
  'atm_due_at',case when a.payment_method='atm' then a.link_expires_at end,
  'registrations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.participant_name,'kind',r.kind,
     'status',r.status)
     order by r.created_at,r.id) from public.course_registrations r where r.order_id=p_order.id),'[]'::jsonb))
 from public.courses c left join lateral (select * from public.course_payment_attempts a
   where a.order_id=p_order.id order by attempt_no desc limit 1) a on true where c.id=p_order.course_id;
$$;

create or replace function public.get_admin_course_roster(p_course_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_backoffice_permission('courses.manage') then
    raise exception '課程管理權限不足' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'registrations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.participant_name, 'kind', r.kind, 'status', r.status,
      'created_at', r.created_at, 'cancelled_at', r.cancelled_at, 'cancel_reason', r.cancel_reason,
      'payer_name', o.payer_name, 'order_id', o.id, 'order_total_twd', o.total_twd,
      'payment_status', case when r.kind = 'instructor_self' then 'free'
        when o.status = 'pending' and o.payment_due_at <= now() then 'expired' else o.status end)
      order by r.created_at, r.id)
      from public.course_registrations r join public.course_orders o on o.id = r.order_id
      where r.course_id = p_course_id), '[]'::jsonb),
    'cases', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc)
      from public.course_manual_cases m join public.course_orders o on o.id = m.order_id
      where o.course_id = p_course_id), '[]'::jsonb));
end;
$$;

create or replace function public.confirm_course_payment(p_provider_order_no text,p_amount_cents integer,p_transaction_no text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare course public.courses%rowtype; target public.course_orders%rowtype; attempt public.course_payment_attempts%rowtype; received_at timestamptz;
begin
 select c.* into course from public.courses c join public.course_orders o on o.course_id=c.id
   join public.course_payment_attempts a on a.order_id=o.id where a.provider_order_no=p_provider_order_no for update of c;
 select o.* into target from public.course_orders o join public.course_payment_attempts a on a.order_id=o.id
   where a.provider_order_no=p_provider_order_no for update of o;
 select * into attempt from public.course_payment_attempts where provider_order_no=p_provider_order_no for update;
 if not found or p_amount_cents is distinct from target.total_twd*100 or coalesce(length(p_transaction_no),0) not between 1 and 80
  or (attempt.provider_transaction_no is not null and attempt.provider_transaction_no<>p_transaction_no) then
   raise exception 'Course payment evidence mismatch' using errcode='22023'; end if;
 if attempt.state in('paid','review') then return public.course_order_summary(target); end if;
 received_at:=clock_timestamp();
 if target.status in('paid','review') then
   update public.course_payment_attempts set state='review',provider_transaction_no=p_transaction_no where provider_order_no=p_provider_order_no;
   insert into public.course_manual_cases(order_id,kind,reason)
    values(target.id,'payment_exception','另一筆付款嘗試亦確認收款，請人工核對重複收款；不重複成立報名或發放購物金')
    on conflict(order_id) where kind='payment_exception' do nothing;
   return public.course_order_summary(target);
 end if;
 if target.status<>'pending' or received_at>=least(target.payment_due_at,course.starts_at)
   or not course.published or (course.publish_at is not null and course.publish_at>received_at)
   or not exists(select 1 from public.course_registrations where order_id=target.id and status='pending') then
   update public.course_orders set status='review',paid_at=received_at where id=target.id returning * into target;
   update public.course_payment_attempts set state='review',provider_transaction_no=p_transaction_no where provider_order_no=p_provider_order_no;
   -- Late/held payment goes to review; enrollment is never automatically cancelled.
   insert into public.course_manual_cases(order_id,kind,reason)
     values(target.id,'payment_exception','已確認銀行收款，但課程或原訂單已不接受付款，請人工處理')
     on conflict(order_id) where kind='payment_exception' do nothing;
 else
   update public.course_orders set status='paid',paid_at=received_at where id=target.id returning * into target;
   update public.course_payment_attempts set state='paid',provider_transaction_no=p_transaction_no where provider_order_no=p_provider_order_no;
   update public.course_registrations set status='active',confirmed_at=received_at where order_id=target.id and status='pending';
 end if;
 return public.course_order_summary(target);
end; $$;

-- Compatibility shim: an old worker or caller cannot auto-cancel unpaid enrollments.
create or replace function public.expire_course_registrations() returns integer
 language sql security definer set search_path='' as $$ select 0; $$;

create or replace function public.cancel_course_registration(p_registration_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare course public.courses%rowtype; reg public.course_registrations%rowtype;
 target_order public.course_orders%rowtype; remaining integer;
begin
 if auth.uid() is null or not public.has_backoffice_permission('courses.manage') then
  raise exception '課程管理權限不足' using errcode='42501'; end if;
 select c.* into course from public.courses c join public.course_registrations r on r.course_id=c.id
  where r.id=p_registration_id for update of c;
 select * into reg from public.course_registrations where id=p_registration_id for update;
 if not found then raise exception '找不到報名紀錄' using errcode='22023'; end if;
 if reg.status='cancelled' then return; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 1 and 500 then
  raise exception '請填寫客人提出取消的原因' using errcode='22023'; end if;
 select * into target_order from public.course_orders where id=reg.order_id for update;
 -- Existing paid/free after-class rules remain unchanged. Unpaid seats can be cancelled after class on request.
 if reg.status='active' and course.ends_at<=clock_timestamp() then
  raise exception '課程已結束，已付款或免費報名請登記課後人工處理' using errcode='22023'; end if;
 update public.course_registrations set status='cancelled',cancelled_at=clock_timestamp(),cancelled_by=auth.uid(),cancel_reason=btrim(p_reason) where id=reg.id;
 if reg.status='pending' and reg.kind<>'instructor_self' then
  select count(*) into remaining from public.course_registrations where order_id=reg.order_id and status='pending' and kind<>'instructor_self';
  if target_order.status in('pending','hold') then
   -- Bank amount/account may already exist. Do not silently charge cancelled seats or rewrite price snapshots.
   update public.course_orders set status=case when remaining>0 then 'hold' else 'cancelled' end where id=reg.order_id;
  end if;
  if remaining>0 or target_order.status='review' then
   insert into public.course_manual_cases(order_id,registration_id,kind,reason,created_by)
    values(reg.order_id,reg.id,case when target_order.paid_at is not null then 'cancelled_paid_registration' else 'cancelled_unpaid_registration' end,'客人要求取消：'||btrim(p_reason)||'。其他報名保留，原付款金額及銀行付款資料須人工確認。',auth.uid())
    on conflict(registration_id) do nothing;
  end if;
 elsif reg.kind<>'instructor_self' and target_order.status='paid' then
  insert into public.course_manual_cases(order_id,registration_id,kind,reason,created_by)
   values(reg.order_id,reg.id,'cancelled_paid_registration',btrim(p_reason),auth.uid()) on conflict(registration_id) do nothing;
 end if;
end; $$;
notify pgrst,'reload schema';
commit;
