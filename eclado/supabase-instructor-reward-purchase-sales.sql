-- Admin-only purchasing display. Requires professional renewals and reward queries.
-- Does not change qualification, reward accounting, or any existing sales rule.
begin;
create or replace function public.get_admin_reward_purchase_sales(
  p_instructor_ids uuid[], p_year integer default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  today date := (now() at time zone 'Asia/Taipei')::date;
  target_year integer := coalesce(p_year,extract(year from today)::integer);
begin
  perform public.assert_instructor_reward_read_admin();
  if p_instructor_ids is null or cardinality(p_instructor_ids)>50
    or array_position(p_instructor_ids,null) is not null
    or target_year<2000 or target_year>extract(year from today)::integer then
    raise exception '叫貨統計查詢條件不正確' using errcode='22023';
  end if;
  return (with ids as (
    select distinct unnest(p_instructor_ids) id
  ), members as (
    select ids.id from ids where exists(select 1 from public.profiles p where p.id=ids.id and p.role='instructor')
      or exists(select 1 from public.instructor_reward_accounts a where a.user_id=ids.id)
  ), month_bounds as (
    select make_date(target_year,m,1) start_date,
      (make_date(target_year,m,1)+interval '1 month')::date end_date,m as month_number
    from generate_series(1,12) m where make_date(target_year,m,1)<=today
  ), month_sales as (
    select members.id,b.month_number,
      coalesce(sum(public.order_net_merchandise_amount(o.subtotal,o.discount,o.total,o.items,o.pricing_snapshot)),0) amount,
      count(o.id) order_count
    from members cross join month_bounds b
    left join public.orders o on o.user_id=members.id
      and o.status in ('paid','preparing','ready_for_pickup','picked_up','shipped','delivered')
      and o.paid_at >= (b.start_date::timestamp at time zone 'Asia/Taipei')
      and o.paid_at < (b.end_date::timestamp at time zone 'Asia/Taipei')
      and exists(select 1 from public.professional_memberships pm where pm.user_id=members.id
        and pm.role in ('instructor','distributor')
        and (o.paid_at at time zone 'Asia/Taipei')::date>=pm.started_on
        and (o.paid_at at time zone 'Asia/Taipei')::date<coalesce(pm.ended_on,'infinity'::date))
    group by members.id,b.month_number
  ), quarter_sales as (
    -- Reuse the LIVE renewal calculation, rather than copy its quarterly rules.
    select members.id,coalesce(jsonb_agg(jsonb_build_object(
      'quarter',q->'calendar_quarter','online_amount',q->'online_sales_amount',
      'offline_amount',q->'offline_sales_amount','amount',q->'sales_amount'
    ) order by q->>'quarter_start') filter(where q is not null),'[]'::jsonb) quarters
    from members left join lateral jsonb_array_elements(
      public.get_professional_renewal_assessment(members.id,target_year)->'quarters') q on true
    group by members.id
  ) select jsonb_build_object('year',target_year,'as_of',today,'accounts',coalesce((
    select jsonb_agg(jsonb_build_object('id',members.id,
      'months',(select jsonb_agg(jsonb_build_object('month',m.month_number,'amount',m.amount,'order_count',m.order_count) order by m.month_number)
        from month_sales m where m.id=members.id),
      'quarters',qs.quarters) order by members.id)
    from members join quarter_sales qs using(id)), '[]'::jsonb)));
end $$;
revoke all on function public.get_admin_reward_purchase_sales(uuid[],integer) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_reward_purchase_sales(uuid[],integer) to authenticated;
notify pgrst,'reload schema';
commit;
