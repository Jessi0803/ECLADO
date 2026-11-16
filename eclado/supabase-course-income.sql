begin;

alter table public.course_manual_cases
  add column refund_twd integer not null default 0 check (refund_twd >= 0);

-- Records a refund already completed outside this system. Locks the order so
-- resolving multiple cases cannot record more than the captured payment.
create function public.resolve_course_case_and_record_refund(
  p_case_id uuid, p_resolution text, p_refund_twd integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  item public.course_manual_cases%rowtype;
  target public.course_orders%rowtype;
  seat_kind text;
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
    select kind into seat_kind from public.course_registrations where id = item.registration_id;
    select coalesce(sum(refund_twd),0) into previously_refunded from public.course_manual_cases where order_id = target.id;
    if target.paid_at is null or target.status not in ('paid','review')
      or seat_kind = 'instructor_self'
      or (item.registration_id is not null and p_refund_twd > target.unit_price_twd)
      or previously_refunded + p_refund_twd > target.total_twd then
      raise exception '退款金額超出可記錄的已收款金額' using errcode = '22023';
    end if;
  end if;

  update public.course_manual_cases set resolved_at = clock_timestamp(), resolved_by = auth.uid(),
    resolution = btrim(p_resolution), refund_twd = p_refund_twd where id = p_case_id;
end;
$$;

create or replace function public.resolve_course_manual_case(p_case_id uuid, p_resolution text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.resolve_course_case_and_record_refund(p_case_id, p_resolution, 0);
end;
$$;

create function public.get_admin_course_income(p_course_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  paid bigint;
  review bigint;
  refunded bigint;
  paid_orders bigint;
begin
  if auth.uid() is null or not public.has_backoffice_permission('courses.manage') then
    raise exception '課程管理權限不足' using errcode = '42501';
  end if;
  select coalesce(sum(total_twd) filter (where status = 'paid'),0),
    coalesce(sum(total_twd) filter (where status = 'review'),0),
    count(*) filter (where status = 'paid')
    into paid, review, paid_orders
  from public.course_orders where course_id = p_course_id and paid_at is not null;
  select coalesce(sum(m.refund_twd),0) into refunded
    from public.course_manual_cases m join public.course_orders o on o.id = m.order_id
    where o.course_id = p_course_id and m.resolved_at is not null;
  return jsonb_build_object('paid_twd',paid,'review_twd',review,'paid_orders',paid_orders,
    'refund_twd',refunded,'net_twd',paid + review - refunded);
end;
$$;

revoke all on function public.get_admin_course_income(uuid),
  public.resolve_course_case_and_record_refund(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.get_admin_course_income(uuid),
  public.resolve_course_case_and_record_refund(uuid,text,integer) to authenticated;

commit;
