begin;

create table public.course_orders (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  payer_id uuid not null,
  payer_name text not null,
  payer_role text not null check (payer_role in ('pro','instructor')),
  request_id uuid not null,
  request_payload jsonb not null,
  course_name text not null,
  unit_price_twd integer not null check (unit_price_twd >= 0),
  paid_seats integer not null check (paid_seats between 0 and 30),
  total_twd integer not null check (total_twd between 0 and 9999999 and total_twd = unit_price_twd * paid_seats),
  status text not null check (status in ('free','pending','paid','failed','review')),
  created_at timestamptz not null default now(),
  payment_due_at timestamptz not null,
  paid_at timestamptz,
  unique (payer_id, request_id),
  unique (id, course_id)
);
create index course_orders_payer_course on public.course_orders(payer_id, course_id, created_at desc);
create index course_orders_course on public.course_orders(course_id, created_at desc);

create table public.course_registrations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null,
  order_id uuid not null,
  member_id uuid,
  participant_name text not null,
  kind text not null check (kind in ('pro_self','instructor_self','delegated')),
  status text not null check (status in ('pending','active','cancelled')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  foreign key (order_id, course_id) references public.course_orders(id, course_id)
);
create index course_registrations_order on public.course_registrations(order_id);
create index course_registrations_course on public.course_registrations(course_id, status);
create unique index course_registrations_member_active on public.course_registrations(course_id, member_id)
where member_id is not null and status in ('pending','active');

create table public.course_payment_attempts (
  order_id uuid primary key references public.course_orders(id),
  provider_order_no text not null unique check (provider_order_no ~ '^CRS[0-9a-f]{32}$'),
  state text not null check (state in ('creating','pending','paid','failed','review')),
  created_at timestamptz not null default now(),
  provider_transaction_no text,
  payment_url text,
  payment_method text not null default 'card' check (payment_method in ('atm','card','apple','google')),
  atm_account text check (atm_account is null or (payment_method = 'atm' and atm_account ~ '^[0-9]{14}$')),
  link_expires_at timestamptz not null
);

create table public.course_manual_cases (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.course_orders(id),
  registration_id uuid unique references public.course_registrations(id),
  kind text not null check (kind in ('cancelled_paid_registration','payment_exception','after_course')),
  reason text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution text
);
create unique index course_payment_exception_once on public.course_manual_cases(order_id) where kind = 'payment_exception';

alter table public.course_orders enable row level security;
alter table public.course_registrations enable row level security;
alter table public.course_payment_attempts enable row level security;
alter table public.course_manual_cases enable row level security;
revoke all on public.course_orders, public.course_registrations, public.course_payment_attempts, public.course_manual_cases
  from public, anon, authenticated;

-- Member responses deliberately omit private payment-attempt and audit data.
create function public.course_order_summary(p_order public.course_orders)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p_order.id, 'course_id', p_order.course_id, 'course_name', p_order.course_name,
    'total_twd', p_order.total_twd, 'status', case when p_order.status = 'pending' and
      p_order.payment_due_at <= now() then 'expired' else p_order.status end,
    'payment_due_at', p_order.payment_due_at, 'paid_at', p_order.paid_at,
    'payment_method', (select a.payment_method from public.course_payment_attempts a where a.order_id = p_order.id),
    'atm_account', (select a.atm_account from public.course_payment_attempts a join public.courses c on c.id = p_order.course_id
      where a.order_id = p_order.id and a.state = 'pending' and p_order.status = 'pending'
        and c.published and least(c.starts_at, a.link_expires_at, p_order.payment_due_at) > now()),
    'atm_due_at', (select a.link_expires_at from public.course_payment_attempts a where a.order_id = p_order.id and a.payment_method = 'atm'),
    'registrations', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.participant_name,
      'kind', r.kind, 'status', case when r.status = 'pending' and p_order.payment_due_at <= now()
        then 'expired' else r.status end) order by r.created_at, r.id)
      from public.course_registrations r where r.order_id = p_order.id), '[]'::jsonb));
$$;

create function public.create_course_registration(p_course_id uuid, p_request_id uuid, p_self boolean,
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
  if not found or not course.published or course.starts_at <= clock_timestamp() then
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
  deadline := least(course.starts_at, clock_timestamp() + interval '30 minutes');
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

create function public.get_my_course_orders(p_course_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '請先登入' using errcode = '42501'; end if;
  if p_course_id is null then
    return jsonb_build_object('courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
        'orders', bookings.orders,
        'zoom_url', case when bookings.has_active and c.ends_at > now() then m.zoom_url end
      ) order by (c.ends_at <= now()),
        case when c.ends_at > now() then c.starts_at end,
        case when c.ends_at <= now() then c.starts_at end desc, c.id)
      from public.courses c
      left join public.course_meeting_details m on m.course_id = c.id
      cross join lateral (
        select jsonb_agg(public.course_order_summary(o) - 'atm_account' order by o.created_at desc, o.id) as orders,
          bool_or(exists (select 1 from public.course_registrations r where r.order_id = o.id and r.status = 'active')) as has_active
        from public.course_orders o where o.payer_id = auth.uid() and o.course_id = c.id
      ) bookings
      where bookings.orders is not null
    ), '[]'::jsonb));
  end if;
  return jsonb_build_object(
    'orders', coalesce((select jsonb_agg(public.course_order_summary(o) order by o.created_at desc)
      from public.course_orders o where o.payer_id = auth.uid() and o.course_id = p_course_id), '[]'::jsonb),
    'ends_at', (select c.ends_at from public.courses c where c.id = p_course_id and exists (
      select 1 from public.course_orders o where o.course_id = c.id and o.payer_id = auth.uid()
    )),
    'zoom_url', (select m.zoom_url from public.course_meeting_details m
      join public.courses c on c.id = m.course_id
      where m.course_id = p_course_id and c.ends_at > now() and exists (
      select 1 from public.course_orders o join public.course_registrations r on r.order_id = o.id
      where o.course_id = p_course_id and o.payer_id = auth.uid() and r.status = 'active'
    ))
  );
end;
$$;

create function public.get_admin_course_roster(p_course_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_backoffice_permission('courses.manage') then
    raise exception '課程管理權限不足' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'registrations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.participant_name, 'kind', r.kind, 'status', case
        when r.status = 'pending' and o.payment_due_at <= now() then 'expired' else r.status end,
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

create function public.cancel_course_registration(p_registration_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  course public.courses%rowtype;
  reg public.course_registrations%rowtype;
  target_order public.course_orders%rowtype;
begin
  if auth.uid() is null or not public.has_backoffice_permission('courses.manage') then
    raise exception '課程管理權限不足' using errcode = '42501';
  end if;
  select c.* into course from public.courses c join public.course_registrations r on r.course_id = c.id
    where r.id = p_registration_id for update of c;
  select * into reg from public.course_registrations where id = p_registration_id for update;
  if not found then raise exception '找不到報名紀錄' using errcode = '22023'; end if;
  if reg.status = 'cancelled' then return; end if;
  if coalesce(char_length(btrim(p_reason)),0) not between 1 and 500 then
    raise exception '請填寫取消原因' using errcode = '22023';
  end if;
  if course.ends_at <= clock_timestamp() then
    raise exception '課程已結束，請登記課後人工處理' using errcode = '22023';
  end if;
  if reg.status <> 'active' then
    raise exception '僅可取消已成立的報名' using errcode = '22023';
  end if;
  select * into target_order from public.course_orders where id = reg.order_id;
  update public.course_registrations set status = 'cancelled', cancelled_at = clock_timestamp(),
    cancelled_by = auth.uid(), cancel_reason = btrim(p_reason) where id = reg.id;
  if reg.kind <> 'instructor_self' and target_order.status = 'paid' then
    insert into public.course_manual_cases (order_id, registration_id, kind, reason, created_by)
    values (reg.order_id, reg.id, 'cancelled_paid_registration', btrim(p_reason), auth.uid());
  end if;
end;
$$;

create function public.record_course_after_class_case(p_registration_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  reg public.course_registrations%rowtype;
  end_time timestamptz;
begin
  if auth.uid() is null or not public.has_backoffice_permission('courses.manage') then
    raise exception '課程管理權限不足' using errcode = '42501';
  end if;
  select r.* into reg from public.course_registrations r where r.id = p_registration_id;
  select ends_at into end_time from public.courses where id = reg.course_id for share;
  if end_time is null or end_time > clock_timestamp() or coalesce(char_length(btrim(p_reason)),0) not between 1 and 500 then
    raise exception '僅可為已結束的課程登記人工處理，且需填寫原因' using errcode = '22023';
  end if;
  insert into public.course_manual_cases (order_id, registration_id, kind, reason, created_by)
    values (reg.order_id, reg.id, 'after_course', btrim(p_reason), auth.uid())
  on conflict (registration_id) do nothing;
end;
$$;

create function public.resolve_course_manual_case(p_case_id uuid, p_resolution text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_backoffice_permission('courses.manage') then
    raise exception '課程管理權限不足' using errcode = '42501';
  end if;
  if coalesce(char_length(btrim(p_resolution)),0) not between 1 and 500 then
    raise exception '請填寫人工處理結果' using errcode = '22023';
  end if;
  update public.course_manual_cases set resolved_at = clock_timestamp(), resolved_by = auth.uid(),
    resolution = btrim(p_resolution) where id = p_case_id and resolved_at is null;
end;
$$;

revoke all on function public.course_order_summary(public.course_orders) from public, anon, authenticated;
revoke all on function public.create_course_registration(uuid,uuid,boolean,jsonb,integer),
  public.get_my_course_orders(uuid), public.get_admin_course_roster(uuid), public.cancel_course_registration(uuid,text),
  public.record_course_after_class_case(uuid,text), public.resolve_course_manual_case(uuid,text) from public, anon, authenticated;
grant execute on function public.create_course_registration(uuid,uuid,boolean,jsonb,integer),
  public.get_my_course_orders(uuid), public.get_admin_course_roster(uuid), public.cancel_course_registration(uuid,text),
  public.record_course_after_class_case(uuid,text), public.resolve_course_manual_case(uuid,text) to authenticated;

commit;
