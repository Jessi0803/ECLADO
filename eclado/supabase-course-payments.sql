begin;

-- Establish the bank mapping before making any external request. A claim is
-- never reissued for the same order, even if the network result is uncertain.
create function public.claim_course_payment(p_order_id uuid, p_payer_id uuid, p_create boolean, p_method text default 'card')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  course public.courses%rowtype;
  target public.course_orders%rowtype;
  attempt public.course_payment_attempts%rowtype;
  minutes integer;
  create_attempt boolean := false;
  deadline timestamptz;
begin
  select c.* into course from public.courses c join public.course_orders o on o.course_id = c.id
    where o.id = p_order_id and o.payer_id = p_payer_id for update of c;
  select * into target from public.course_orders where id = p_order_id and payer_id = p_payer_id for update;
  if not found then return null; end if;
  select * into attempt from public.course_payment_attempts where order_id = target.id;
  if p_create and attempt.order_id is null and (p_method is null or p_method not in ('atm','card','apple','google')
    or (p_method = 'atm' and target.total_twd > 30000)) then
    return jsonb_build_object('method_unavailable', true);
  end if;
  deadline := date_trunc('minute', least(course.starts_at, target.payment_due_at));
  minutes := least(10, floor(extract(epoch from (least(course.starts_at, target.payment_due_at) - clock_timestamp())) / 60)::integer);
  if p_create and target.status = 'pending' and course.published and minutes >= 1 and attempt.order_id is null
    and exists(select 1 from public.profiles where id = p_payer_id and role = target.payer_role) then
    insert into public.course_payment_attempts(order_id, provider_order_no, state, link_expires_at, payment_method)
    values (target.id, 'CRS' || replace(target.id::text, '-', ''), 'creating',
      case when p_method = 'atm' then deadline else clock_timestamp() + make_interval(mins => minutes) end, p_method)
    returning * into attempt;
    create_attempt := true;
  end if;
  return jsonb_build_object('summary', public.course_order_summary(target), 'provider_order_no', attempt.provider_order_no,
    'create_attempt', create_attempt, 'minutes', minutes, 'payment_method', attempt.payment_method, 'link_expires_at', attempt.link_expires_at,
    'payment_url', case when p_create and target.status = 'pending' and course.published
      and least(attempt.link_expires_at, course.starts_at, target.payment_due_at) > clock_timestamp()
      and exists(select 1 from public.profiles where id = p_payer_id and role = target.payer_role)
      then attempt.payment_url end);
end;
$$;

create function public.store_course_payment_link(p_provider_order_no text, p_payment_url text, p_transaction_no text, p_atm_account text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_payment_url is null or p_payment_url !~ '^https://' or length(p_payment_url) > 2048
    or coalesce(length(p_transaction_no),0) not between 1 and 80 then
    raise exception 'Invalid course payment link' using errcode = '22023';
  end if;
  update public.course_payment_attempts set state = 'pending',
    payment_url = p_payment_url, provider_transaction_no = p_transaction_no, atm_account = p_atm_account
    where provider_order_no = p_provider_order_no and state = 'creating';
end;
$$;

create function public.fail_course_payment_creation(p_provider_order_no text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target_id uuid;
begin
  perform c.id from public.courses c join public.course_orders o on o.course_id = c.id
    join public.course_payment_attempts a on a.order_id = o.id
    where a.provider_order_no = p_provider_order_no for update of c;
  update public.course_payment_attempts set state = 'failed'
    where provider_order_no = p_provider_order_no and state = 'creating'
    returning order_id into target_id;
  if target_id is null then return; end if;
  update public.course_orders set status = 'failed' where id = target_id and status = 'pending';
  update public.course_registrations set status = 'cancelled', cancelled_at = clock_timestamp(),
    cancel_reason = '銀行未建立付款單' where order_id = target_id and status = 'pending';
end;
$$;

create function public.get_course_payment_target(p_provider_order_no text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'course_id', o.course_id, 'total', o.total_twd,
    'provider_transaction_no', a.provider_transaction_no, 'payment_method', a.payment_method)
  from public.course_payment_attempts a join public.course_orders o on o.id = a.order_id
  where a.provider_order_no = p_provider_order_no;
$$;

create function public.confirm_course_payment(p_provider_order_no text, p_amount_cents integer, p_transaction_no text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  course public.courses%rowtype;
  target public.course_orders%rowtype;
  attempt public.course_payment_attempts%rowtype;
  received_at timestamptz;
begin
  select c.* into course from public.courses c join public.course_orders o on o.course_id = c.id
    join public.course_payment_attempts a on a.order_id = o.id
    where a.provider_order_no = p_provider_order_no for update of c;
  select o.* into target from public.course_orders o join public.course_payment_attempts a on a.order_id = o.id
    where a.provider_order_no = p_provider_order_no for update of o;
  select * into attempt from public.course_payment_attempts where order_id = target.id for update;
  if not found or p_amount_cents is distinct from target.total_twd * 100
    or coalesce(length(p_transaction_no),0) not between 1 and 80
    or (attempt.provider_transaction_no is not null and attempt.provider_transaction_no <> p_transaction_no) then
    raise exception 'Course payment evidence mismatch' using errcode = '22023';
  end if;
  if target.status in ('paid', 'review') then return public.course_order_summary(target); end if;
  received_at := clock_timestamp();
  if target.status = 'failed' or received_at >= least(target.payment_due_at, course.starts_at) or not course.published then
    update public.course_orders set status = 'review', paid_at = received_at where id = target.id returning * into target;
    update public.course_payment_attempts set state = 'review', provider_transaction_no = p_transaction_no
      where order_id = target.id;
    update public.course_registrations set status = 'cancelled', cancelled_at = received_at, cancel_reason = '付款需人工確認'
      where order_id = target.id and status = 'pending';
    insert into public.course_manual_cases(order_id, kind, reason)
      values (target.id, 'payment_exception', '已確認銀行收款，但課程或原訂單已不接受付款，請人工處理');
  else
    update public.course_orders set status = 'paid', paid_at = received_at where id = target.id returning * into target;
    update public.course_payment_attempts set state = 'paid', provider_transaction_no = p_transaction_no
      where order_id = target.id;
    update public.course_registrations set status = 'active', confirmed_at = received_at
      where order_id = target.id and status = 'pending';
  end if;
  return public.course_order_summary(target);
end;
$$;

revoke all on function public.claim_course_payment(uuid,uuid,boolean,text), public.store_course_payment_link(text,text,text,text),
  public.fail_course_payment_creation(text), public.get_course_payment_target(text), public.confirm_course_payment(text,integer,text) from public, anon, authenticated;
grant execute on function public.claim_course_payment(uuid,uuid,boolean,text), public.store_course_payment_link(text,text,text,text),
  public.fail_course_payment_creation(text), public.get_course_payment_target(text), public.confirm_course_payment(text,integer,text) to service_role;

commit;
