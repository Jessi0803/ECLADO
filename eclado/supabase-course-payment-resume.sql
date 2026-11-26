-- Apply after course publication schedule / slugs. TEST first; no production activation.
begin;

-- Preserve every bank attempt, including existing provider identifiers.
alter table public.course_payment_attempts add column if not exists attempt_no integer not null default 1;
alter table public.course_payment_attempts drop constraint course_payment_attempts_pkey;
alter table public.course_payment_attempts add primary key(order_id, attempt_no);
alter table public.course_payment_attempts add constraint course_attempt_positive check(attempt_no > 0);

-- The order deadline follows class time. Never revive cancelled seats or paid orders.
update public.course_orders o set payment_due_at=c.starts_at
from public.courses c where c.id=o.course_id and o.status='pending' and c.starts_at>now()
  and exists(select 1 from public.course_registrations r where r.order_id=o.id and r.status='pending');
create function public.sync_course_payment_deadline() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.course_orders o set payment_due_at=new.starts_at
    where o.course_id=new.id and o.status='pending'
      and exists(select 1 from public.course_registrations r where r.order_id=o.id and r.status='pending');
  return new;
end; $$;
create trigger course_payment_deadline after update of starts_at on public.courses
  for each row when(old.starts_at is distinct from new.starts_at) execute function public.sync_course_payment_deadline();
revoke all on function public.sync_course_payment_deadline() from public,anon,authenticated,service_role;

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

  -- A new request can replace expired pending seats. A late verified payment
  -- for their old order will go to manual review.
  update public.course_registrations r set status = 'cancelled', cancelled_at = clock_timestamp(),
    cancel_reason = '付款期限已過'
  from public.course_orders o where r.order_id = o.id and r.course_id = course.id and r.status = 'pending'
    and o.status = 'pending' and o.payment_due_at <= clock_timestamp();

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
     'status',case when r.status='pending' and least(p_order.payment_due_at,c.starts_at)<=now() then 'expired' else r.status end)
     order by r.created_at,r.id) from public.course_registrations r where r.order_id=p_order.id),'[]'::jsonb))
 from public.courses c left join lateral (select * from public.course_payment_attempts a
   where a.order_id=p_order.id order by attempt_no desc limit 1) a on true where c.id=p_order.course_id;
$$;

create or replace function public.claim_course_payment(p_order_id uuid,p_payer_id uuid,p_create boolean,p_method text default 'card')
returns jsonb language plpgsql security definer set search_path='' as $$
declare course public.courses%rowtype; target public.course_orders%rowtype;
 attempt public.course_payment_attempts%rowtype; minutes integer; deadline timestamptz; created boolean:=false; eligible boolean;
begin
 select c.* into course from public.courses c join public.course_orders o on o.course_id=c.id
   where o.id=p_order_id and o.payer_id=p_payer_id for update of c;
 select * into target from public.course_orders where id=p_order_id and payer_id=p_payer_id for update;
 if not found then return null; end if;
 select * into attempt from public.course_payment_attempts where order_id=target.id order by attempt_no desc limit 1;
 eligible:=target.status='pending' and course.published and (course.publish_at is null or course.publish_at<=clock_timestamp())
   and least(course.starts_at,target.payment_due_at)>clock_timestamp()
   and exists(select 1 from public.profiles where id=p_payer_id and role=target.payer_role)
   and exists(select 1 from public.course_registrations where order_id=target.id and status='pending');
 if p_create and attempt.order_id is null and (p_method is null or p_method not in('atm','card','apple','google')
     or (p_method='atm' and target.total_twd>30000)) then return jsonb_build_object('method_unavailable',true); end if;
 minutes:=least(10,floor(extract(epoch from (least(course.starts_at,target.payment_due_at)-clock_timestamp()))/60)::integer);
 deadline:=date_trunc('minute',least(course.starts_at,target.payment_due_at,clock_timestamp()+interval '29 days'));
 if p_create and eligible and minutes>=1 and attempt.order_id is null then
   insert into public.course_payment_attempts(order_id,provider_order_no,state,link_expires_at,payment_method)
   values(target.id,'CRS'||replace(target.id::text,'-',''),'creating',
     case when p_method='atm' then deadline else clock_timestamp()+make_interval(mins=>minutes) end,p_method) returning * into attempt;
   created:=true;
 end if;
 return jsonb_build_object('summary',public.course_order_summary(target),'provider_order_no',attempt.provider_order_no,
   'attempt_no',attempt.attempt_no,'attempt_state',attempt.state,'eligible',eligible,'create_attempt',created,
   'minutes',minutes,'payment_method',attempt.payment_method,'link_expires_at',attempt.link_expires_at,
   'payment_url',case when p_create and eligible and attempt.state='pending'
     and least(attempt.link_expires_at,course.starts_at,target.payment_due_at)>clock_timestamp() then attempt.payment_url end);
end; $$;

-- Compare-and-swap the verified previous attempt while holding the same course/order lock as bank callbacks.
create function public.renew_course_payment(p_order_id uuid,p_payer_id uuid,p_previous_provider text,p_bank_status text)
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
   or least(target.payment_due_at,course.starts_at)<=clock_timestamp()
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
 minutes:=least(10,floor(extract(epoch from (least(course.starts_at,target.payment_due_at)-clock_timestamp()))/60)::integer);
 if minutes<1 then return jsonb_build_object('blocked',true); end if;
 next_no:=attempt.attempt_no+1;
 expiry:=case when attempt.payment_method='atm' then date_trunc('minute',least(course.starts_at,target.payment_due_at,clock_timestamp()+interval '29 days'))
   else clock_timestamp()+make_interval(mins=>minutes) end;
 insert into public.course_payment_attempts(order_id,attempt_no,provider_order_no,state,link_expires_at,payment_method)
 values(target.id,next_no,'CRS'||replace(gen_random_uuid()::text,'-',''),'creating',expiry,attempt.payment_method) returning * into attempt;
 return jsonb_build_object('summary',public.course_order_summary(target),'provider_order_no',attempt.provider_order_no,
  'attempt_no',attempt.attempt_no,'payment_method',attempt.payment_method,'link_expires_at',attempt.link_expires_at,'minutes',minutes,'create_attempt',true);
end; $$;

-- A definite bank rejection leaves the original registration available for retry.
create or replace function public.fail_course_payment_creation(p_provider_order_no text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform c.id from public.courses c join public.course_orders o on o.course_id=c.id
  join public.course_payment_attempts a on a.order_id=o.id where a.provider_order_no=p_provider_order_no for update of c;
 update public.course_payment_attempts set state='failed' where provider_order_no=p_provider_order_no and state='creating';
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
 if target.status='failed' or received_at>=least(target.payment_due_at,course.starts_at)
   or not course.published or (course.publish_at is not null and course.publish_at>received_at)
   or not exists(select 1 from public.course_registrations where order_id=target.id and status='pending') then
   update public.course_orders set status='review',paid_at=received_at where id=target.id returning * into target;
   update public.course_payment_attempts set state='review',provider_transaction_no=p_transaction_no where provider_order_no=p_provider_order_no;
   update public.course_registrations set status='cancelled',cancelled_at=received_at,cancel_reason='付款需人工確認'
     where order_id=target.id and status='pending';
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

revoke all on function public.renew_course_payment(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.renew_course_payment(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
