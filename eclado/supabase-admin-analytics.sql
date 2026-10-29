-- Deploy before the analytics client. Read-only; no payment/order/inventory changes.
begin;
create or replace function public.get_admin_analytics(p_start_date date, p_end_date date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
set timezone = 'Asia/Taipei'
as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_eclado_admin()
    or not public.has_backoffice_permission('analytics.read') then
    raise exception 'Analytics read access required' using errcode = '42501';
  end if;
  if p_start_date is null or p_end_date is null
    or not isfinite(p_start_date) or not isfinite(p_end_date)
    or p_start_date > p_end_date then
    raise exception 'Invalid analytics date range' using errcode = '22023';
  end if;
  if p_end_date >= (p_start_date + interval '1 year')::date then
    raise exception '查詢期間最多一年，請縮短開始與結束日期的範圍。' using errcode = '22023';
  end if;
  with dated as materialized (
    select o.total, o.type, o.items,
      case when o.type in ('pro','instructor','distributor','staff') then o.type
        when o.type = 'consumer' and o.user_id is not null then 'consumer'
        when o.type in ('consumer','guest') and o.user_id is null then 'guest'
        else 'other' end as member_role,
      case
        when btrim(coalesce(nullif(o.date, ''), o.created_at::text)) ~ '^\d{4}-\d{2}-\d{2}$'
          then case when pg_input_is_valid(btrim(o.date), 'date') then btrim(o.date)::date end
        when pg_input_is_valid(btrim(coalesce(nullif(o.date, ''), o.created_at::text)), 'timestamp with time zone')
          then (btrim(coalesce(nullif(o.date, ''), o.created_at::text))::timestamptz at time zone 'Asia/Taipei')::date
      end as day
    from public.orders o
    where o.status in ('paid','preparing','ready_for_pickup','picked_up','shipped','delivered')
      and o.order_source is distinct from 'historical_manual'
  ), sales as materialized (
    select * from dated where day between p_start_date and p_end_date
  ), daily_roles as (
    select day,member_role,coalesce(sum(total),0) revenue,count(*) orders
    from sales group by day,member_role
  ), daily as (
    select day,sum(revenue) revenue,sum(orders) orders,
      coalesce(sum(revenue) filter (where member_role in ('pro','instructor','distributor')),0) pro_revenue,
      jsonb_object_agg(member_role,revenue) by_role
    from daily_roles group by day
  ), lines as (
    select s.day,
      coalesce(nullif(item->>'product_id',''), nullif(item->>'productId',''), nullif(item->>'id',''),
        'name:' || lower(regexp_replace(coalesce(item->>'name',item->>'nameZh',item->>'name_zh','未記錄商品'), '\s+', '', 'g'))) product_key,
      coalesce(nullif(item->>'variant_id',''),nullif(item->>'variantId',''),
        'size:' || coalesce(nullif(item->>'size',''),nullif(item->>'variantSize',''),'未記錄規格')) variant_key,
      coalesce(nullif(item->>'nameZh',''),nullif(item->>'name',''),nullif(item->>'name_zh',''),'未記錄商品') name,
      coalesce(nullif(item->>'size',''),nullif(item->>'variantSize',''),'未記錄規格') size,
      case when pg_input_is_valid(item->>'qty','numeric')
        then case when (item->>'qty')::numeric > 0 and (item->>'qty')::numeric < 'Infinity'::numeric
          then (item->>'qty')::numeric else 0 end else 0 end qty,
      coalesce(item->>'line_type','') = 'gift' or coalesce(item->>'is_gift',item->>'isGift','false') = 'true' gift
    from sales s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.items)='array' then s.items else '[]'::jsonb end) item
  ), products as (
    select day, product_key, variant_key, name, size,
      sum(qty) filter (where not gift) quantity, sum(qty) filter (where gift) gifts
    from lines group by day, product_key, variant_key, name, size
  )
  select jsonb_build_object(
    'startDate',p_start_date,'endDate',p_end_date,
    'memberRevenue',coalesce((select jsonb_agg(jsonb_build_object('role',member_role,'revenue',revenue,'orders',orders) order by member_role)
      from (select member_role,coalesce(sum(total),0) revenue,count(*) orders from sales group by member_role) roles),'[]'::jsonb),
    'daily',coalesce((select jsonb_agg(jsonb_build_object('date',day,'revenue',revenue,'orders',orders,'proRevenue',pro_revenue,'byRole',by_role) order by day) from daily),'[]'::jsonb),
    'productSales',coalesce((select jsonb_agg(jsonb_build_object('date',day,'productKey',product_key,'variantKey',variant_key,
      'name',name,'size',size,'quantity',coalesce(quantity,0),'gifts',coalesce(gifts,0)) order by day,product_key,variant_key) from products),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_admin_analytics(date,date) from public, anon;
grant execute on function public.get_admin_analytics(date,date) to authenticated;
commit;
