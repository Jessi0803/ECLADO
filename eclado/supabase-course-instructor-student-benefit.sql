-- Apply after supabase-course-payment-cutoff-30-minutes.sql. TEST first.
-- Existing enrollments retain their original fee/reward eligibility.
begin;
alter table public.course_registrations add column benefit_free boolean not null default false;
alter table public.course_registrations add constraint course_registration_benefit_bound_student
  check (not benefit_free or (kind = 'delegated' and member_id is not null));
comment on column public.course_registrations.benefit_free is 'Snapshot: instructor waived fee for own active bound student at registration; no shopping credit or refund.';
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
  benefit_free boolean;
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

  -- Unpaid/overdue enrollments remain registered; only staff can cancel on request.
  if p_self and exists (select 1 from public.course_registrations r where r.course_id = course.id
    and r.member_id = actor and r.status in ('pending','active')) then
    raise exception '您已報名此課程，請查看既有報名' using errcode = '23505';
  end if;
  if member.role = 'instructor' then paid_count := 0; end if;
  for entry in select value from jsonb_array_elements(p_participants) loop
    student_id := null;
    if jsonb_typeof(entry) is distinct from 'object' then
      raise exception '參加者資料格式有誤' using errcode = '22023';
    end if;
    if entry ? 'benefit_free' and jsonb_typeof(entry->'benefit_free') is distinct from 'boolean' then
      raise exception '免費報名選項格式有誤' using errcode = '22023';
    end if;
    benefit_free := coalesce((entry->>'benefit_free')::boolean, false);
    if benefit_free and (member.role <> 'instructor' or not (entry ? 'binding_id')) then
      raise exception '僅可為自己的綁定學生使用師資權益' using errcode = '42501';
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
    people := people || jsonb_build_array(jsonb_build_object('member_id', student_id, 'name', full_name, 'benefit_free', benefit_free));
    if not benefit_free then paid_count := paid_count + 1; end if;
  end loop;

  full_name := nullif(btrim(member.name), '');
  if full_name is null then raise exception '請先在會員資料填寫姓名' using errcode = '22023'; end if;
  if paid_count > 0 and (course.price_twd = 0 or course.price_twd * paid_count > 9999999) then
    raise exception '課程付款金額超出可受理範圍，請聯繫客服' using errcode = '22023';
  end if;
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
  insert into public.course_registrations (course_id, order_id, member_id, participant_name, kind, status, benefit_free, confirmed_at)
  select course.id, saved.id, (item->>'member_id')::uuid, item->>'name', 'delegated',
    case when (item->>'benefit_free')::boolean then 'active' else 'pending' end,
    (item->>'benefit_free')::boolean,
    case when (item->>'benefit_free')::boolean then now() end
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
     'status',r.status,'benefit_free',r.benefit_free)
     order by r.created_at,r.id) from public.course_registrations r where r.order_id=p_order.id),'[]'::jsonb))
 from public.courses c left join lateral (select * from public.course_payment_attempts a
   where a.order_id=p_order.id and a.retired_at is null order by attempt_no desc limit 1) a on true where c.id=p_order.course_id;
$$;

create or replace function public.get_admin_course_roster(p_course_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_backoffice_permission('courses.manage') then
    raise exception '課程管理權限不足' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'registrations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.participant_name, 'kind', r.kind, 'status', r.status, 'benefit_free', r.benefit_free,
      'created_at', r.created_at, 'cancelled_at', r.cancelled_at, 'cancel_reason', r.cancel_reason,
      'payer_name', o.payer_name, 'order_id', o.id, 'order_total_twd', o.total_twd,
      'payment_status', case when r.kind = 'instructor_self' or r.benefit_free then 'free'
        when o.status = 'pending' and least(o.payment_due_at,public.course_payment_deadline(c.starts_at)) <= now() then 'expired' else o.status end)
      order by r.created_at, r.id)
      from public.course_registrations r join public.course_orders o on o.id = r.order_id join public.courses c on c.id=o.course_id
      where r.course_id = p_course_id), '[]'::jsonb),
    'cases', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc)
      from public.course_manual_cases m join public.course_orders o on o.id = m.order_id
      where o.course_id = p_course_id), '[]'::jsonb));
end;
$$;

create or replace view public.pending_course_shopping_credit as
select r.id as registration_id, r.course_id, r.order_id, o.payer_id,
  o.unit_price_twd as credit_amount,
  case when r.kind = 'pro_self' then 'course_pro_grant' else 'course_delegated_grant' end as reason_code
from public.course_registrations r
join public.course_orders o on o.id = r.order_id and o.course_id = r.course_id
join public.profiles p on p.id = o.payer_id
left join public.shopping_credit_accounts a on a.user_id = o.payer_id
where r.status = 'active' and not r.benefit_free
  and ((r.kind = 'delegated' and o.payer_role = 'instructor')
    or (r.kind = 'pro_self' and o.payer_role = 'pro' and r.member_id = o.payer_id))
  and o.status = 'paid' and o.paid_at is not null and o.unit_price_twd > 0
  and (a.user_id is null or a.status = 'active')
  and not exists (
    select 1 from public.shopping_credit_ledger l
    where l.event_type = 'grant' and l.reason_code in ('course_delegated_grant', 'course_pro_grant')
      and l.metadata->>'course_registration_id' = r.id::text
  );
revoke all on public.pending_course_shopping_credit from public, anon, authenticated, service_role;


create or replace view public.course_notice_recipients as
select r.id as registration_id, r.course_id, o.payer_id, r.kind = 'delegated' as delegated
from public.course_registrations r
join public.course_orders o on o.id = r.order_id
where r.status = 'active'
  and ((r.kind = 'instructor_self' and o.payer_role = 'instructor') or (r.benefit_free and o.payer_role = 'instructor') or o.status = 'paid');
revoke all on public.course_notice_recipients from public, anon, authenticated, service_role;


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
 elsif reg.kind<>'instructor_self' and not reg.benefit_free and target_order.status='paid' then
  insert into public.course_manual_cases(order_id,registration_id,kind,reason,created_by)
   values(reg.order_id,reg.id,'cancelled_paid_registration',btrim(p_reason),auth.uid()) on conflict(registration_id) do nothing;
 end if;
end; $$;

create or replace function public.resolve_course_case_and_record_refund(
  p_case_id uuid, p_resolution text, p_refund_twd integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  item public.course_manual_cases%rowtype;
  target public.course_orders%rowtype;
  seat_kind text;
  seat_free boolean;
  previously_refunded bigint;
begin
  if auth.uid() is null or not public.has_backoffice_permission('courses.manage') then
    raise exception '課程管理權限不足' using errcode = '42501';
  end if;
  if coalesce(char_length(btrim(p_resolution)),0) not between 1 and 500
    or p_refund_twd is null or p_refund_twd < 0 then
    raise exception '請填寫處理結果與正確退款金額' using errcode = '22023';
  end if;

  select o.* into target from public.course_orders o
    join public.course_manual_cases m on m.order_id = o.id
    where m.id = p_case_id for update of o;
  if not found then raise exception '找不到人工案件' using errcode = '22023'; end if;
  select * into item from public.course_manual_cases where id = p_case_id for update;
  if item.resolved_at is not null then
    if item.refund_twd = p_refund_twd and item.resolution = btrim(p_resolution) then return; end if;
    raise exception '案件已結案，請重新整理' using errcode = '22023';
  end if;
  if p_refund_twd > 0 then
    select kind, benefit_free into seat_kind, seat_free from public.course_registrations where id = item.registration_id;
    select coalesce(sum(refund_twd),0) into previously_refunded from public.course_manual_cases where order_id = target.id;
    if target.paid_at is null or target.status not in ('paid','review')
      or seat_kind = 'instructor_self' or coalesce(seat_free,false)
      or (item.registration_id is not null and p_refund_twd > target.unit_price_twd)
      or previously_refunded + p_refund_twd > target.total_twd then
      raise exception '退款金額超出可記錄的已收款金額' using errcode = '22023';
    end if;
  end if;

  update public.course_manual_cases set resolved_at = clock_timestamp(), resolved_by = auth.uid(),
    resolution = btrim(p_resolution), refund_twd = p_refund_twd where id = p_case_id;
end;
$$;

notify pgrst, 'reload schema';
commit;
