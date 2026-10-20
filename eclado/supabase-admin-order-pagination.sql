-- Apply before the paginated orders client. Additive read-only RPCs; no business writes.
begin;

-- Match the JS mapper's finite, floored, non-negative quantities, including old snapshots.
create or replace function public._admin_order_quantity(value jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
declare n numeric; t text;
begin
  if value is null then return null; end if;
  if value = 'null'::jsonb or value = 'false'::jsonb then return 0; end if;
  if value = 'true'::jsonb then return 1; end if;
  t := btrim(value #>> '{}');
  if t = '' then return 0; end if;
  if not pg_input_is_valid(t, 'numeric') then return null; end if;
  n := t::numeric;
  if n::text in ('NaN', 'Infinity', '-Infinity') then return null; end if;
  return greatest(0, floor(n));
end;
$$;

create or replace function public._admin_order_inventory_state(order_id text, status text, source text, items jsonb)
returns text language plpgsql stable set search_path = '' as $$
declare
  line record; persisted jsonb; quantity numeric; allocated numeric; backordered numeric;
  snapshot_stock numeric; all_allocated boolean := true; has_backorder boolean := false;
  active_status boolean := status in ('paid','preparing','ready_for_pickup','picked_up','shipped','delivered');
begin
  if source = 'historical_manual' or not (active_status or (source = 'admin_assisted' and status in ('unpaid','awaiting_confirm')))
    or jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) = 0 then return null; end if;
  for line in
    select i.value, a.allocated_qty, a.backorder_qty, a.order_id is not null as canonical
    from jsonb_array_elements(items) with ordinality i(value, index)
    left join public.order_inventory_allocations a on a.order_id = _admin_order_inventory_state.order_id and a.item_index = i.index - 1
  loop
    quantity := coalesce(public._admin_order_quantity(line.value -> 'qty'), 0);
    persisted := case when line.canonical then jsonb_build_object('allocated_qty',line.allocated_qty,'backorder_qty',line.backorder_qty)
      when jsonb_typeof(line.value -> 'inventory_allocation') = 'object' then line.value -> 'inventory_allocation' else '{}'::jsonb end;
    allocated := public._admin_order_quantity(coalesce(nullif(persisted -> 'allocated_qty','null'::jsonb), line.value -> 'allocated_stock_qty'));
    backordered := public._admin_order_quantity(coalesce(nullif(persisted -> 'backorder_qty','null'::jsonb), line.value -> 'backorder_qty'));
    if allocated is not null or backordered is not null then
      allocated := least(quantity, coalesce(allocated, greatest(0,quantity-backordered)));
      backordered := least(quantity, coalesce(backordered, greatest(0,quantity-allocated)));
    else
      snapshot_stock := public._admin_order_quantity(line.value -> 'stock_at_order');
      if active_status and snapshot_stock is not null then
        allocated := least(quantity,snapshot_stock); backordered := greatest(0,quantity-allocated);
      else all_allocated := false;
      end if;
    end if;
    if backordered > 0 then has_backorder := true; end if;
  end loop;
  return case when has_backorder then 'backordered' when all_allocated then 'in_stock' else null end;
end;
$$;

-- Private reusable projection: do not grant it to API roles. Only guarded RPCs call it.
create or replace function public._admin_order_list_rows(search text)
returns table(id text, member text, type text, total numeric, status text, date text, user_id uuid,
  order_source text, fulfillment_method text, created_at timestamptz, payment_method text, payment_state text,
  note text, member_note text, inventory_state text, inventory_eligible boolean)
language sql stable set search_path = '' as $$
  select o.id, o.member, o.type, o.total, normalized.status, o.date, o.user_id,
    coalesce(o.order_source,'online'), coalesce(o.fulfillment_method,o.pricing_snapshot ->> 'fulfillment_method','delivery'), o.created_at,
    payment.method, coalesce(attempt.payment_state,instruction.payment_state,''),
    left(coalesce(o.note,''),1000), coalesce(m.note,''),
    public._admin_order_inventory_state(o.id,normalized.status,coalesce(o.order_source,'online'),o.items),
    o.order_source is distinct from 'historical_manual' and (normalized.status in ('paid','preparing','ready_for_pickup','picked_up','shipped','delivered')
      or (o.order_source = 'admin_assisted' and normalized.status in ('unpaid','awaiting_confirm')))
  from public.orders o
  left join public.order_payment_instructions instruction on instruction.order_id = o.id
  left join lateral (
    select a.payment_method, a.payment_state from public.order_payment_attempts a
    where a.order_id = o.id order by a.attempt_no desc limit 1
  ) attempt on true
  cross join lateral (select coalesce(nullif(attempt.payment_method,''),nullif(instruction.payment_method,''),o.assisted_payment_method,'') as method) payment
  cross join lateral (select case when o.status in ('unpaid','awaiting_confirm') and payment.method = 'atm' then 'awaiting_confirm'
    when o.status in ('unpaid','awaiting_confirm') and payment.method in ('card','apple','google') then 'unpaid' else o.status end as status) normalized
  left join public.member_admin_notes m on m.user_id = o.user_id
  where coalesce(btrim(search),'') = ''
    or strpos(lower(concat_ws(' ',o.id,o.member,o.email,o.phone,o.tracking)),lower(btrim(search))) > 0;
$$;

create or replace function public.get_admin_orders_page(p_page integer default 1, p_page_size integer default 50,
  p_status text default 'all', p_inventory text default 'all', p_search text default '')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_eclado_admin() or not public.has_backoffice_permission('orders.read') then
    raise exception 'Orders read access required' using errcode = '42501'; end if;
  if p_page is null or p_page < 1 or p_page > 100000 or p_page_size is null or p_page_size < 1 or p_page_size > 100
    or p_status is null or p_status not in ('all','awaiting_confirm','unpaid','paid','preparing','shipped','delivered','returned','cancelled')
    or p_inventory is null or p_inventory not in ('all','in_stock','backordered') or char_length(coalesce(p_search,'')) > 200 then
    raise exception 'Invalid order page parameters' using errcode = '22023'; end if;
  with base as materialized (select * from public._admin_order_list_rows(p_search)),
  by_status as materialized (
    select * from base where case p_status when 'all' then status <> 'cancelled'
      when 'shipped' then status in ('shipped','ready_for_pickup') when 'delivered' then status in ('delivered','picked_up') else status = p_status end
  ), filtered as materialized (
    select * from by_status where p_inventory = 'all' or inventory_state = p_inventory
  ), totals as (
    select count(*) as total, least(p_page,greatest(1,ceil(count(*)::numeric/p_page_size)::int)) as page from filtered
  ), page_rows as (
    select f.* from filtered f order by created_at desc,id desc
    limit p_page_size offset ((select page from totals)-1)*p_page_size
  )
  select jsonb_build_object(
    'page',t.page,'pageSize',p_page_size,'total',t.total,
    'statusCounts',jsonb_build_object('awaiting_confirm',(select count(*) from base where status='awaiting_confirm'),'unpaid',(select count(*) from base where status='unpaid')),
    'inventoryCounts',jsonb_build_object('eligible',(select count(*) from by_status where inventory_eligible),
      'in_stock',(select count(*) from by_status where inventory_state='in_stock'),'backordered',(select count(*) from by_status where inventory_state='backordered')),
    'orders',coalesce((select jsonb_agg(to_jsonb(r) - 'inventory_eligible' order by r.created_at desc,r.id desc) from page_rows r),'[]'::jsonb)
  ) into result from totals t;
  return result;
end;
$$;

create or replace function public.get_admin_order_detail(p_order_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare target public.orders%rowtype; payment_attempts jsonb; latest jsonb; group_data jsonb; order_data jsonb;
begin
  if auth.uid() is null or not public.is_eclado_admin() or not public.has_backoffice_permission('orders.read') then
    raise exception 'Orders read access required' using errcode = '42501'; end if;
  if p_order_id is null or char_length(p_order_id) not between 1 and 200 then
    raise exception 'Invalid order ID' using errcode = '22023'; end if;
  select * into target from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.attempt_no),'[]'::jsonb) into payment_attempts from (
    select a.attempt_no,a.payment_method,a.payment_state,a.provider_status,left(a.provider_description,300) as provider_description,a.created_at,a.updated_at
    from public.order_payment_attempts a where a.order_id = target.id
    union all
    select coalesce(i.attempt_no,1),i.payment_method,i.payment_state,i.provider_status,left(i.provider_description,300),i.gateway_created_at,i.updated_at
    from public.order_payment_instructions i where i.order_id = target.id
      and not exists (select 1 from public.order_payment_attempts a where a.order_id = target.id)
  ) p;
  latest := payment_attempts -> -1;
  if target.shipping_group_id is not null then
    select jsonb_build_object('id',g.id,'status',g.status,'created_at',g.created_at,'locked_at',g.locked_at,
      'original_order_id',g.original_order_id,'original_shipping_amount',g.original_shipping_amount,
      'effective_total',t.effective_total,'valid_order_count',t.valid_count,'pending_order_count',t.pending_count,
      'free_shipping',t.effective_total >= 15000,'shipping_refunded',g.shipping_refund_ledger_id is not null,
      'shipping_refunded_at',g.shipping_refunded_at,'orders',t.orders,
      'requires_manual_review',g.shipping_refund_ledger_id is not null and t.effective_total < 15000,
      'below_minimum_warning',t.effective_total > 0 and t.effective_total < 5000) into group_data
    from public.shipping_groups g cross join lateral (
      select coalesce(sum(public.shipping_group_effective_amount(o)) filter (where public.is_shipping_group_valid_order_status(o.status)),0) as effective_total,
        count(*) filter (where public.is_shipping_group_valid_order_status(o.status)) as valid_count,
        count(*) filter (where o.status in ('awaiting_confirm','unpaid')) as pending_count,
        jsonb_agg(jsonb_build_object('id',o.id,'status',o.status,'effective_amount',public.shipping_group_effective_amount(o),
          'is_valid',public.is_shipping_group_valid_order_status(o.status)) order by o.created_at,o.id) as orders
      from public.orders o where o.shipping_group_id = g.id
    ) t where g.id = target.shipping_group_id;
  end if;
  -- Explicit allowlist prevents future order columns (tokens, credentials) entering the detail response.
  select jsonb_object_agg(key,value) into order_data from jsonb_each(to_jsonb(target)) where key = any(array[
    'id','member','type','items','total','status','paid_at','date','created_at','address','phone','email','note','transfer_last5',
    'tracking','shipping_carrier','shipped_at','shipment_notification_sent_at','shipment_notification_channel','shipment_notification_error','user_id',
    'subtotal','discount','promotion_name','coupon_name','coupon_code_mask','coupon_campaign_id','invoice_type','invoice_company_name','invoice_tax_id','invoice_number',
    'shopping_credit_amount','shopping_credit_discount','store_credit_discount','reward_credit_amount','payment_amount',
    'studio_name_snapshot','studio_name','pricing_snapshot','fulfillment_method','order_source','transaction_date','assisted_payment_method'
  ]);
  order_data := order_data || jsonb_build_object(
    'admin_note',coalesce((select note from public.order_admin_notes where order_id=target.id),''),
    'inventory_allocations',coalesce((select jsonb_agg(jsonb_build_object('item_index',a.item_index,'allocated_qty',a.allocated_qty,'backorder_qty',a.backorder_qty,'state',a.state))
      from public.order_inventory_allocations a where a.order_id=target.id),'[]'::jsonb),
    'shipping_group',group_data,'payment_method',coalesce(nullif(latest ->> 'payment_method',''),(select payment_method from public.order_payment_instructions where order_id=target.id),target.assisted_payment_method,''),
    'payment_state',coalesce(latest ->> 'payment_state',''),'payment_attempt_count',jsonb_array_length(payment_attempts),
    'payment_attempts',payment_attempts,'payment_updated_at',coalesce(latest ->> 'updated_at',latest ->> 'created_at'),
    'provider_status',coalesce(latest ->> 'provider_status',''),'provider_description',coalesce(latest ->> 'provider_description','')
  );
  return jsonb_build_object('order',order_data,
    'memberNote',coalesce((select note from public.member_admin_notes where user_id=target.user_id),''),
    'linkedMemberExists',public.has_backoffice_permission('members.read') and exists(select 1 from public.profiles where id=target.user_id));
end;
$$;

revoke all on function public._admin_order_quantity(jsonb) from public,anon,authenticated;
revoke all on function public._admin_order_inventory_state(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public._admin_order_list_rows(text) from public,anon,authenticated;
revoke all on function public.get_admin_orders_page(integer,integer,text,text,text) from public,anon;
revoke all on function public.get_admin_order_detail(text) from public,anon;
grant execute on function public.get_admin_orders_page(integer,integer,text,text,text) to authenticated;
grant execute on function public.get_admin_order_detail(text) to authenticated;
notify pgrst, 'reload schema';
commit;
