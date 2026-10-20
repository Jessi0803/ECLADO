-- Read-only financial projection with immutable export audit. Apply separately.
begin;
create table if not exists public.instructor_reward_redemption_exports (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  filters jsonb not null,
  row_count integer not null check(row_count>=0)
);
alter table public.instructor_reward_redemption_exports enable row level security;
revoke all on public.instructor_reward_redemption_exports from public,anon,authenticated,service_role;
drop trigger if exists reward_redemption_exports_immutable on public.instructor_reward_redemption_exports;
create trigger reward_redemption_exports_immutable before update or delete on public.instructor_reward_redemption_exports
  for each row execute function public.reject_instructor_reward_history_changes();

create or replace function public.export_admin_reward_redemptions(
  p_start_date date default null,p_end_date date default null,p_search text default '',p_status text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; export_id uuid; row_count integer;
begin
  perform public.assert_instructor_reward_read_admin();
  if (p_start_date is not null and p_end_date is not null and p_start_date>p_end_date)
    or p_search is null or length(p_search)>100 or p_status is null
    or p_status not in('','reserved','consumed','released','refunded','missing') then
    raise exception '匯出篩選條件不正確' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.order_id),'[]'::jsonb) into payload from (
    select o.id order_id,o.created_at,coalesce(p.name,'已刪除會員') instructor_name,
      o.total,o.shopping_credit_amount,o.reward_credit_amount,o.payment_amount,o.status order_status,
      coalesce(r.status,'missing') redemption_status,
      coalesce(events.consumed_amount,0) consumed_amount,coalesce(events.refunded_amount,0) refunded_amount,
      events.consumed_at,events.refunded_at,events.released_at,
      exists(select 1 from public.instructor_reward_payment_exceptions e where e.order_id=o.id) payment_exception
    from public.orders o
    left join public.instructor_reward_reservations r on r.order_id=o.id
    left join public.profiles p on p.id=coalesce(r.user_id,o.user_id)
    left join lateral (
      select sum(l.amount) filter(where l.event_type='spend_consume') consumed_amount,
        sum(l.amount) filter(where l.event_type='spend_refund') refunded_amount,
        max(l.created_at) filter(where l.event_type='spend_consume') consumed_at,
        max(l.created_at) filter(where l.event_type='spend_refund') refunded_at,
        max(l.created_at) filter(where l.event_type='spend_release') released_at
      from public.instructor_reward_ledger l where l.order_id=o.id
    ) events on true
    where o.reward_credit_amount>0
      and (p_start_date is null or o.created_at >= (p_start_date::timestamp at time zone 'Asia/Taipei'))
      and (p_end_date is null or o.created_at < ((p_end_date+1)::timestamp at time zone 'Asia/Taipei'))
      and (btrim(p_search)='' or position(lower(btrim(p_search)) in lower(coalesce(p.name,'')||' '||o.id))>0)
      and (p_status='' or coalesce(r.status,'missing')=p_status)
    order by o.created_at desc,o.id limit 10001
  ) q;
  row_count:=jsonb_array_length(payload);
  if row_count>10000 then raise exception '符合條件超過 10,000 筆，請縮小匯出範圍' using errcode='54000'; end if;
  insert into public.instructor_reward_redemption_exports(actor_user_id,filters,row_count)
    values(auth.uid(),jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,'search',btrim(p_search),'status',p_status),row_count)
    returning id into export_id;
  return jsonb_build_object('export_id',export_id,'count',row_count,'rows',payload);
end $$;
revoke all on function public.export_admin_reward_redemptions(date,date,text,text) from public,anon,authenticated,service_role;
grant execute on function public.export_admin_reward_redemptions(date,date,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
