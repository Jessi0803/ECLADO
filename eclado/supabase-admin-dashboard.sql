-- Apply before deploying the dashboard client. Read-only, bounded dashboard payload.
-- No order/payment/inventory writes and no changes to existing RLS policies.
begin;

create or replace function public.get_admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'Asia/Taipei'
as $$
declare
  month_start date := date_trunc('month', now() at time zone 'Asia/Taipei')::date;
  can_read_members boolean;
  can_read_catalog boolean;
  result jsonb;
begin
  -- Match the existing orders RLS and payment RPC administrator boundary.
  if auth.uid() is null or not public.is_eclado_admin()
    or not public.has_backoffice_permission('orders.read') then
    raise exception 'Orders read access required' using errcode = '42501';
  end if;
  can_read_members := public.has_backoffice_permission('members.read');
  can_read_catalog := public.has_backoffice_permission('catalog.read');

  with months as (
    select (month_start - make_interval(months => n))::date as month
    from generate_series(0, 5) n
  ), sales as (
    select
      case
        when btrim(coalesce(nullif(o.date, ''), o.created_at::text)) ~ '^\d{4}-\d{2}-\d{2}$'
          then left(btrim(coalesce(nullif(o.date, ''), o.created_at::text)), 7)
        when pg_input_is_valid(btrim(coalesce(nullif(o.date, ''), o.created_at::text)), 'timestamp with time zone')
          then to_char(btrim(coalesce(nullif(o.date, ''), o.created_at::text))::timestamptz at time zone 'Asia/Taipei', 'YYYY-MM')
        else null
      end as month_key,
      o.total, o.type
    from public.orders o
    where o.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')
      and o.order_source is distinct from 'historical_manual'
  ), monthly as (
    select m.month,
      coalesce(sum(s.total), 0) as revenue,
      count(s.month_key) as orders,
      coalesce(sum(s.total) filter (where s.type in ('pro', 'instructor', 'distributor')), 0) as pro_revenue
    from months m
    left join sales s on s.month_key = to_char(m.month, 'YYYY-MM')
    group by m.month
  ), recent as (
    select o.id, o.member, o.total, o.status, o.date, o.created_at,
      o.transaction_date, o.order_source, o.assisted_payment_method
    from public.orders o
    order by o.created_at desc, o.id desc
    limit 5
  ), recent_with_payment as (
    select r.*, coalesce(payment.payment_state, '') as payment_state,
      coalesce(nullif(payment.payment_method, ''), nullif(instruction.payment_method, ''), r.assisted_payment_method, '') as payment_method
    from recent r
    left join public.order_payment_instructions instruction on instruction.order_id = r.id
    left join lateral (
      select a.payment_method, a.payment_state
      from public.order_payment_attempts a
      where a.order_id = r.id
      order by a.attempt_no desc
      limit 1
    ) attempt on true
    left join lateral (
      select
        case when attempt.payment_method is not null then attempt.payment_method else instruction.payment_method end as payment_method,
        case when attempt.payment_method is not null then attempt.payment_state else instruction.payment_state end as payment_state
    ) payment on true
  )
  select jsonb_build_object(
    'monthlyRevenue', (select jsonb_agg(jsonb_build_object(
      'key', to_char(m.month, 'YYYY-MM'), 'month', extract(month from m.month)::int || '月',
      'year', extract(year from m.month)::int, 'revenue', m.revenue,
      'orders', m.orders, 'proRevenue', m.pro_revenue
    ) order by m.month) from monthly m),
    'paidOrderCount', (select count(*) from public.orders where status = 'paid'),
    'pendingApplicationCount', case when can_read_members then
      (select count(*) from public.professional_applications where status = 'pending') else 0 end,
    'lowStock', case when can_read_catalog then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'nameZh', coalesce(p.name_zh, ''), 'size', coalesce(p.size, ''),
        'stock', coalesce(p.stock, 0), 'minStock', coalesce(nullif(p.min_stock, 0), 3)
      ) order by p.id)
      from public.products p
      where (case when p.publication_status is not null then p.publication_status = 'active' else p.active is not false end)
        and coalesce(p.stock, 0) <= coalesce(nullif(p.min_stock, 0), 3)
    ), '[]'::jsonb) else '[]'::jsonb end,
    'recentOrders', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'member', r.member, 'total', r.total, 'status',
      case when r.status in ('awaiting_confirm', 'unpaid') and r.payment_method = 'atm' then 'awaiting_confirm'
        when r.status in ('awaiting_confirm', 'unpaid') and r.payment_method in ('card', 'apple', 'google') then 'unpaid'
        else r.status end,
      'date', r.date, 'transactionDate', coalesce(r.transaction_date::text, r.date),
      'orderSource', coalesce(r.order_source, 'online'), 'paymentState', r.payment_state
    ) order by r.created_at desc, r.id desc) from recent_with_payment r), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_admin_dashboard() from public, anon;
grant execute on function public.get_admin_dashboard() to authenticated;
comment on function public.get_admin_dashboard() is
  'Dashboard aggregates and five recent orders only; preserves admin, catalog and member access boundaries.';

commit;
