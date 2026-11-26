-- Apply after supabase-course-expiry-recovery.sql. TEST first.
-- New deadline: 30 minutes before class. Expiry never cancels enrollment.
begin;
create function public.course_payment_deadline(p_starts_at timestamptz)
returns timestamptz language sql immutable strict set search_path='' as $$
 select p_starts_at - interval '30 minutes';
$$;
create or replace function public.sync_course_payment_deadline() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.course_orders o set payment_due_at=public.course_payment_deadline(new.starts_at)
    where o.course_id=new.id and o.status='pending'
      and exists(select 1 from public.course_registrations r where r.order_id=o.id and r.status='pending');
  return new;
end; $$;

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
  deadline := public.course_payment_deadline(course.starts_at);
  if paid_count > 0 and deadline < clock_timestamp() + interval '1 minute' then
    raise exception '已達付款截止時間（開課前 30 分鐘）或剩餘付款時間不足，無法新增付費報名' using errcode = '22023';
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
  'total_twd',p_order.total_twd,'status',case when p_order.status='pending' and least(p_order.payment_due_at,public.course_payment_deadline(c.starts_at))<=now() then 'expired' else p_order.status end,
  'payment_due_at',least(p_order.payment_due_at,public.course_payment_deadline(c.starts_at)),'paid_at',p_order.paid_at,
  'payment_method',a.payment_method,'payment_link_expires_at',a.link_expires_at,
  'payment_attempt_state',a.state,
  'atm_account',case when a.payment_method='atm' and a.state='pending' and p_order.status='pending'
    and c.published and least(a.link_expires_at,p_order.payment_due_at,public.course_payment_deadline(c.starts_at))>now() then a.atm_account end,
  'atm_due_at',case when a.payment_method='atm' then a.link_expires_at end,
  'registrations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.participant_name,'kind',r.kind,
     'status',r.status)
     order by r.created_at,r.id) from public.course_registrations r where r.order_id=p_order.id),'[]'::jsonb))
 from public.courses c left join lateral (select * from public.course_payment_attempts a
   where a.order_id=p_order.id and a.retired_at is null order by attempt_no desc limit 1) a on true where c.id=p_order.course_id;
$$;

create or replace function public.claim_course_payment(p_order_id uuid,p_payer_id uuid,p_create boolean,p_method text default 'card')
returns jsonb language plpgsql security definer set search_path='' as $$
declare course public.courses%rowtype; target public.course_orders%rowtype;
 attempt public.course_payment_attempts%rowtype; minutes integer; deadline timestamptz; created boolean:=false; eligible boolean; next_no integer;
begin
 select c.* into course from public.courses c join public.course_orders o on o.course_id=c.id
   where o.id=p_order_id and o.payer_id=p_payer_id for update of c;
 select * into target from public.course_orders where id=p_order_id and payer_id=p_payer_id for update;
 if not found then return null; end if;
 select * into attempt from public.course_payment_attempts where order_id=target.id and retired_at is null order by attempt_no desc limit 1;
 eligible:=target.status='pending' and course.published and (course.publish_at is null or course.publish_at<=clock_timestamp())
   and least(public.course_payment_deadline(course.starts_at),target.payment_due_at)>clock_timestamp()
   and exists(select 1 from public.profiles where id=p_payer_id and role=target.payer_role)
   and exists(select 1 from public.course_registrations where order_id=target.id and status='pending');
 if p_create and attempt.order_id is null and (p_method is null or p_method not in('atm','card','apple','google')
     or (p_method='atm' and target.total_twd>30000)) then return jsonb_build_object('method_unavailable',true); end if;
 minutes:=least(10,floor(extract(epoch from (least(public.course_payment_deadline(course.starts_at),target.payment_due_at)-clock_timestamp()))/60)::integer);
 deadline:=date_trunc('minute',least(public.course_payment_deadline(course.starts_at),target.payment_due_at,clock_timestamp()+interval '29 days'));
 if p_create and eligible and minutes>=1 and attempt.order_id is null then
   select coalesce(max(attempt_no),0)+1 into next_no from public.course_payment_attempts where order_id=target.id;
   insert into public.course_payment_attempts(order_id,attempt_no,provider_order_no,state,link_expires_at,payment_method)
   values(target.id,next_no,'CRS'||replace(case when next_no=1 then target.id::text else gen_random_uuid()::text end,'-',''),'creating',
     case when p_method='atm' then deadline else clock_timestamp()+make_interval(mins=>minutes) end,p_method) returning * into attempt;
   created:=true;
 end if;
 return jsonb_build_object('summary',public.course_order_summary(target),'provider_order_no',attempt.provider_order_no,
   'attempt_no',attempt.attempt_no,'attempt_state',attempt.state,'eligible',eligible,'create_attempt',created,
   'minutes',minutes,'payment_method',attempt.payment_method,'link_expires_at',attempt.link_expires_at,
   'payment_url',case when p_create and eligible and attempt.state='pending'
     and least(attempt.link_expires_at,public.course_payment_deadline(course.starts_at),target.payment_due_at)>clock_timestamp() then attempt.payment_url end);
end; $$;

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
 if attempt.retired_at is not null or target.status<>'pending' or received_at>=least(target.payment_due_at,public.course_payment_deadline(course.starts_at))
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

create or replace function public.recover_expired_course_enrollment(
 p_order_id uuid,p_previous_provider text,p_bank_status text,p_bank_checked_at timestamptz,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare course public.courses%rowtype; target public.course_orders%rowtype;
 attempt public.course_payment_attempts%rowtype; seat public.course_registrations%rowtype;
 prior public.course_expiry_recoveries%rowtype;
begin
 select c.* into course from public.courses c join public.course_orders o on o.course_id=c.id
  where o.id=p_order_id for update of c;
 select * into target from public.course_orders where id=p_order_id for update;
 if not found then raise exception '找不到原課程訂單' using errcode='22023'; end if;
 select * into prior from public.course_expiry_recoveries where order_id=target.id;
 if found then
  if prior.previous_provider_order_no is distinct from p_previous_provider then
   raise exception '原付款紀錄不符' using errcode='22023'; end if;
  return public.course_order_summary(target);
 end if;
 if p_bank_status is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500
  or p_bank_checked_at is null or p_bank_checked_at>clock_timestamp()+interval '10 seconds'
  or p_bank_checked_at<clock_timestamp()-interval '5 minutes' then
  raise exception '需要最新的銀行未付款查證與恢復原因' using errcode='22023'; end if;
 select * into attempt from public.course_payment_attempts where order_id=target.id order by attempt_no desc limit 1 for update;
 if not found or attempt.provider_order_no is distinct from p_previous_provider or attempt.retired_at is not null
  or attempt.state not in('pending','failed') or attempt.link_expires_at>clock_timestamp()
  or not ((attempt.payment_method='card' and p_bank_status='1C250')
    or (attempt.payment_method in('apple','google') and p_bank_status='1M250')) then
  raise exception '原銀行交易尚未確認逾期未付款' using errcode='22023'; end if;
 if target.status<>'pending' or target.paid_at is not null or target.payer_role<>'pro'
  or target.paid_seats<>1 or target.total_twd<>target.unit_price_twd or target.payment_due_at>clock_timestamp()
  or not course.published or (course.publish_at is not null and course.publish_at>clock_timestamp())
  or public.course_payment_deadline(course.starts_at)<clock_timestamp()+interval '1 minute'
  or not exists(select 1 from public.profiles where id=target.payer_id and role='pro')
  or exists(select 1 from public.course_manual_cases where order_id=target.id)
  or exists(select 1 from public.course_payment_attempts where order_id=target.id and state in('paid','review','creating'))
  or (select count(*) from public.course_registrations where order_id=target.id)<>1 then
  raise exception '此原訂單不符合逾期恢復條件' using errcode='22023'; end if;
 select * into seat from public.course_registrations where order_id=target.id for update;
 if seat.kind<>'pro_self' or seat.status<>'cancelled' or seat.cancel_reason is distinct from '付款期限已過'
  or seat.cancelled_by is not null or seat.confirmed_at is not null then
  raise exception '只可恢復付款逾期自動取消的美容師本人報名' using errcode='22023'; end if;
 if exists(select 1 from public.course_registrations r join public.course_orders o on o.id=r.order_id
  where r.course_id=course.id and r.id<>seat.id and r.status in('pending','active')
  and ((seat.member_id is not null and r.member_id=seat.member_id)
   or (r.kind='pro_self' and o.payer_id=target.payer_id))) then
  raise exception '會員已有同堂課的有效報名，不可重複恢復' using errcode='23505'; end if;
 insert into public.course_expiry_recoveries(order_id,previous_provider_order_no,bank_status,bank_checked_at,
  old_payment_due_at,new_payment_due_at,previous_cancellations,reason)
 values(target.id,attempt.provider_order_no,p_bank_status,p_bank_checked_at,target.payment_due_at,public.course_payment_deadline(course.starts_at),
  jsonb_build_object('registration_id',seat.id,'status',seat.status,'cancelled_at',seat.cancelled_at,
   'cancelled_by',seat.cancelled_by,'cancel_reason',seat.cancel_reason),btrim(p_reason));
 update public.course_payment_attempts set retired_at=clock_timestamp(),retirement_bank_status=p_bank_status
  where provider_order_no=attempt.provider_order_no;
 update public.course_registrations set status='pending',cancelled_at=null,cancelled_by=null,cancel_reason=null
  where id=seat.id;
 update public.course_orders set payment_due_at=public.course_payment_deadline(course.starts_at) where id=target.id returning * into target;
 return public.course_order_summary(target);
end; $$;

create or replace function public.renew_course_payment(p_order_id uuid,p_payer_id uuid,p_previous_provider text,p_bank_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare course public.courses%rowtype; target public.course_orders%rowtype; attempt public.course_payment_attempts%rowtype;
 minutes integer; expiry timestamptz; next_no integer;
begin
 select c.* into course from public.courses c join public.course_orders o on o.course_id=c.id
   where o.id=p_order_id and o.payer_id=p_payer_id for update of c;
 select * into target from public.course_orders where id=p_order_id and payer_id=p_payer_id for update;
 if not found then return null; end if;
 select * into attempt from public.course_payment_attempts where order_id=target.id order by attempt_no desc limit 1 for update;
 if attempt.provider_order_no is distinct from p_previous_provider then return jsonb_build_object('changed',true); end if;
 if target.status<>'pending' or not course.published or (course.publish_at is not null and course.publish_at>clock_timestamp())
   or least(target.payment_due_at,public.course_payment_deadline(course.starts_at))<=clock_timestamp()
   or not exists(select 1 from public.profiles where id=p_payer_id and role=target.payer_role)
   or not exists(select 1 from public.course_registrations where order_id=target.id and status='pending') then
   return jsonb_build_object('blocked',true,'summary',public.course_order_summary(target)); end if;
 if not ((attempt.payment_method='atm' and p_bank_status='1A250')
   or (attempt.payment_method='card' and p_bank_status in('1C250','1C350','1C351'))
   or (attempt.payment_method in('apple','google') and p_bank_status in('1M250','1M350','1M351'))
   or (attempt.state='failed' and p_bank_status='NOT_CREATED')) then
   raise exception '付款結果尚未確認，請稍後再試' using errcode='22023'; end if;
 if attempt.state='review' or attempt.state='paid' then return jsonb_build_object('blocked',true); end if;
 -- Do not replace a live ATM account even if an inconsistent bank status is returned.
 if attempt.state<>'failed' and attempt.link_expires_at>clock_timestamp() then return jsonb_build_object('blocked',true); end if;
 minutes:=least(10,floor(extract(epoch from (least(public.course_payment_deadline(course.starts_at),target.payment_due_at)-clock_timestamp()))/60)::integer);
 if minutes<1 then return jsonb_build_object('blocked',true); end if;
 next_no:=attempt.attempt_no+1;
 expiry:=case when attempt.payment_method='atm' then date_trunc('minute',least(public.course_payment_deadline(course.starts_at),target.payment_due_at,clock_timestamp()+interval '29 days'))
   else clock_timestamp()+make_interval(mins=>minutes) end;
 insert into public.course_payment_attempts(order_id,attempt_no,provider_order_no,state,link_expires_at,payment_method)
 values(target.id,next_no,'CRS'||replace(gen_random_uuid()::text,'-',''),'creating',expiry,attempt.payment_method) returning * into attempt;
 return jsonb_build_object('summary',public.course_order_summary(target),'provider_order_no',attempt.provider_order_no,
  'attempt_no',attempt.attempt_no,'payment_method',attempt.payment_method,'link_expires_at',attempt.link_expires_at,'minutes',minutes,'create_attempt',true);
end; $$;

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
        when o.status = 'pending' and least(o.payment_due_at,public.course_payment_deadline(c.starts_at)) <= now() then 'expired' else o.status end)
      order by r.created_at, r.id)
      from public.course_registrations r join public.course_orders o on o.id = r.order_id join public.courses c on c.id=o.course_id
      where r.course_id = p_course_id), '[]'::jsonb),
    'cases', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc)
      from public.course_manual_cases m join public.course_orders o on o.id = m.order_id
      where o.course_id = p_course_id), '[]'::jsonb));
end;
$$;

create or replace function public.claim_course_payment_reminder(p_line_available boolean,p_email_from text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.course_notifications%rowtype; order_record public.course_orders%rowtype; course_record public.courses%rowtype;
 target text; route text; token uuid; payload jsonb; fingerprint text; last_sent timestamptz; due timestamptz; names jsonb;
begin
 perform public.expire_course_registrations();
 -- Only insert reminders already due. A late worker coalesces the first/final stages.
 insert into public.course_notifications(course_id,payer_id,kind,order_id)
 select c.id,o.payer_id,stage.kind,o.id from public.course_orders o join public.courses c on c.id=o.course_id
 cross join lateral (select case
  when least(o.payment_due_at,public.course_payment_deadline(c.starts_at))-o.created_at<interval '24 hours' then 'payment_final'
  when clock_timestamp()>=c.starts_at-interval '24 hours' then 'payment_final'
  else 'payment_first' end as kind) stage
 where o.status='pending' and c.published and (c.publish_at is null or c.publish_at<=clock_timestamp())
 and least(o.payment_due_at,public.course_payment_deadline(c.starts_at))>clock_timestamp()
 and exists(select 1 from public.course_registrations r where r.order_id=o.id and r.status='pending')
 and ((stage.kind='payment_first' and o.created_at+interval '24 hours'<=clock_timestamp())
  or (stage.kind='payment_final' and case
    when least(o.payment_due_at,public.course_payment_deadline(c.starts_at))-o.created_at<interval '24 hours' then o.created_at+interval '1 hour'
    else c.starts_at-interval '24 hours' end<=clock_timestamp()))
 and not exists(select 1 from public.course_notifications old where old.order_id=o.id and old.kind=stage.kind)
 order by o.created_at,o.id limit 250
 on conflict(order_id,kind) where kind in('payment_first','payment_final') do nothing;

 for n in select * from public.course_notifications where kind in('payment_first','payment_final')
  and status in('pending','retry','sending') and next_attempt_at<=clock_timestamp()
  order by next_attempt_at,id limit 25 for update skip locked loop
  select * into course_record from public.courses where id=n.course_id for share;
  select * into order_record from public.course_orders where id=n.order_id for share;
  due:=least(order_record.payment_due_at,public.course_payment_deadline(course_record.starts_at));
  select jsonb_agg(r.participant_name order by r.created_at,r.id) into names
   from public.course_registrations r where r.order_id=order_record.id and r.status='pending';
  if order_record.status<>'pending' or not course_record.published or (course_record.publish_at is not null and course_record.publish_at>clock_timestamp())
    or due<=clock_timestamp() or names is null then
   update public.course_notifications set status=case when attempts>0 then 'unknown' else 'skipped' end,result='no_longer_eligible',lease_token=null where id=n.id;
   continue;
  end if;
  if n.kind='payment_first' and clock_timestamp()>=course_record.starts_at-interval '24 hours' then
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
    then order_record.created_at+interval '1 hour' else course_record.starts_at-interval '24 hours' end) then
   update public.course_notifications set next_attempt_at=case when due-order_record.created_at<interval '24 hours'
    then order_record.created_at+interval '1 hour' else course_record.starts_at-interval '24 hours' end where id=n.id;
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

-- Update only unpaid orders with retained enrollment; paid/free/cancelled history is preserved.
update public.course_orders o set payment_due_at=public.course_payment_deadline(c.starts_at)
from public.courses c where c.id=o.course_id and o.status='pending'
 and exists(select 1 from public.course_registrations r where r.order_id=o.id and r.status='pending');
-- Already issued bank links may have a later bank expiry. They are never re-exposed
-- after the new cutoff; any verified late receipt follows the existing manual-review path.
notify pgrst,'reload schema';
commit;
