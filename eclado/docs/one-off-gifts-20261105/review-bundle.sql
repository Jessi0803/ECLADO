-- GENERATED REVIEW BUNDLE. Only run in isolated DB for now. Entire file defaults to ROLLBACK.
-- REVIEW ONLY: exact-order compatibility; default ROLLBACK, never executed on production.
-- Install and supplement together using review-bundle.sql after separate execution authorization.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.orders in access exclusive mode;
do $install$
declare
  release_def text := $release_source$CREATE OR REPLACE FUNCTION public.release_inventory_for_order(target_order_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  allocation record;
  one_off_gift boolean;
  supplement_item jsonb;
  expected_variant bigint;
  expected_promotion uuid;
begin
  -- Match the payment/FIFO lock order: variants first, allocations second.
  perform 1
  from public.product_variants variant
  where variant.id in (
    select item.product_variant_id
    from public.order_inventory_allocations item
    where item.order_id = target_order_id
      and item.state <> 'released'
  )
  order by variant.id
  for update;

  for allocation in
    select *
    from public.order_inventory_allocations
    where order_id = target_order_id
      and state <> 'released'
    order by product_variant_id, item_index
    for update
  loop
    one_off_gift := false;
    -- Exact order, exact appended positions. Original rows 0..6 retain legacy behavior.
    if target_order_id = 'ECL-20261103-155424-8308FA6E' and allocation.item_index >= 7 then
      expected_variant := case allocation.item_index when 7 then 38 when 8 then 87 when 9 then 104 when 10 then 105 end;
      expected_promotion := case when allocation.item_index in (7,8)
        then '6a03c582-3102-4b0a-a063-229ea1e28b21'::uuid
        when allocation.item_index in (9,10) then '44478b76-3cee-4157-918f-ecb4fc15f275'::uuid end;
      select items -> (allocation.item_index::integer) into supplement_item from public.orders where id = target_order_id;
      if expected_variant is null or coalesce(allocation.product_variant_id = expected_variant
          and allocation.promotion_id = expected_promotion and allocation.line_type = 'gift'
          and allocation.source = 'promotion_gift' and allocation.requested_qty = 1
          and allocation.allocated_qty = 1 and allocation.stock_deducted_qty = 1
          and allocation.backorder_qty = 0 and allocation.released_qty = 0 and allocation.state = 'allocated'
          and supplement_item ->> 'supplement_operation_key' = 'one_off_1111_phase2_20261105_8308FA6E'
          and supplement_item ->> 'variant_id' = expected_variant::text
          and supplement_item ->> 'promotion_id' = expected_promotion::text
          and supplement_item ->> 'line_type' = 'gift' and supplement_item ->> 'is_gift' = 'true'
          and supplement_item ->> 'qty' = '1', false) is not true then
        raise exception 'One-off gift allocation mismatch; manual review required for order % item %', target_order_id, allocation.item_index using errcode = '55000';
      end if;
      -- Do not assume a stock deduction without its matching consumed reservation.
      perform 1 from public.promotion_gift_reservations where order_id = target_order_id
        and promotion_id = expected_promotion and product_variant_id = expected_variant
        and quantity = 1 and status = 'consumed' for update;
      if not found then raise exception 'One-off gift consumed reservation missing' using errcode = '55000'; end if;
      one_off_gift := true;
    end if;
    if allocation.stock_deducted_qty > 0 then
      if one_off_gift then
        update public.product_variants set gift_stock = gift_stock + allocation.stock_deducted_qty
          where id = allocation.product_variant_id;
        if not found then raise exception 'One-off gift variant missing' using errcode = '55000'; end if;
        update public.promotion_gift_reservations set status = 'released', released_at = now(),
          release_reason = 'one_off_supplement_inventory_release'
          where order_id = target_order_id and promotion_id = expected_promotion
          and product_variant_id = expected_variant and status = 'consumed';
      else
        update public.product_variants
        set stock = stock + allocation.stock_deducted_qty
        where id = allocation.product_variant_id;
      end if;

      insert into public.inventory_allocation_events (
        allocation_id, order_id, product_variant_id, event_type, quantity, actor_user_id
      ) values (
        allocation.id, target_order_id, allocation.product_variant_id,
        'release', allocation.stock_deducted_qty, auth.uid()
      );
    end if;

    update public.order_inventory_allocations
    set
      released_qty = released_qty + allocated_qty,
      allocated_qty = 0,
      backorder_qty = 0,
      stock_deducted_qty = 0,
      state = 'released',
      released_at = now(),
      updated_at = now()
    where id = allocation.id;

    if not one_off_gift then
      perform public.sync_product_stock_mirror(allocation.product_id);
    end if;
  end loop;
end;
$function$
$release_source$;
  allocate_def text := $allocate_source$CREATE OR REPLACE FUNCTION public.allocate_inventory_for_paid_order(target_order_id text, order_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  item record;
  item_qty integer;
  variant_id bigint;
  available_qty integer;
  allocated integer;
  missing integer;
  allocation_id bigint;
  product_id integer;
  sku text;
  product_name text;
  variant_name text;
begin
  -- This order's added gifts have already been allocated by the one-off transaction.
  -- Refuse any later full-order allocation, including cancelled/returned -> paid.
  if target_order_id = 'ECL-20261103-155424-8308FA6E' then
    if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(order_items) = 'array' then order_items else '[]'::jsonb end) i
        where i ->> 'supplement_operation_key' = 'one_off_1111_phase2_20261105_8308FA6E')
      or exists (select 1 from public.orders o where o.id = target_order_id and
        exists (select 1 from jsonb_array_elements(coalesce(o.pricing_snapshot -> 'one_time_supplements','[]'::jsonb)) s
          where s ->> 'operation_key' = 'one_off_1111_phase2_20261105_8308FA6E'))
      or exists (select 1 from public.order_adjustments a where a.order_id = target_order_id
        and a.metadata ->> 'operation_key' = 'one_off_1111_phase2_20261105_8308FA6E')
      or exists (select 1 from public.audit_logs a where a.entity_id = target_order_id
        and a.metadata ->> 'operation_key' = 'one_off_1111_phase2_20261105_8308FA6E') then
      raise exception 'One-off supplemented order cannot be reallocated or reopened; manual review required' using errcode = '55000';
    end if;
  end if;
  if order_items is null or jsonb_typeof(order_items) <> 'array' then
    raise exception 'Order items must be an array' using errcode = '22023';
  end if;

  -- Lock every referenced variant in deterministic order. This prevents two
  -- multi-item payments from taking the same row locks in opposite order.
  perform 1
  from public.product_variants variant
  where variant.id in (
    select (entry.value ->> 'variant_id')::bigint
    from jsonb_array_elements(order_items) entry
    where coalesce(entry.value ->> 'variant_id', '') ~ '^[0-9]+$'
  )
  order by variant.id
  for update;

  for item in
    select value, (ordinality - 1)::integer as item_index
    from jsonb_array_elements(order_items) with ordinality
  loop
    item_qty := coalesce(nullif(item.value ->> 'qty', '')::integer, 0);
    if item_qty <= 0 then
      raise exception 'Invalid quantity on order % item %', target_order_id, item.item_index
        using errcode = '22023';
    end if;

    variant_id := case
      when coalesce(item.value ->> 'variant_id', '') ~ '^[0-9]+$'
        then (item.value ->> 'variant_id')::bigint
      else null
    end;
    if variant_id is null then
      select variant.id into variant_id
      from public.product_variants variant
      where variant.product_id = nullif(item.value ->> 'product_id', '')::integer
        and variant.is_default is true
      order by variant.id
      limit 1
      for update;
    end if;

    select
      variant.product_id,
      variant.sku,
      variant.size,
      variant.stock,
      product.name_zh
    into product_id, sku, variant_name, available_qty, product_name
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where variant.id = variant_id
    for update of variant;

    if not found then
      raise exception 'Product variant is missing for order % item %', target_order_id, item.item_index
        using errcode = 'P0002';
    end if;

    allocated := least(item_qty, greatest(coalesce(available_qty, 0), 0));
    missing := item_qty - allocated;

    if allocated > 0 then
      update public.product_variants
      set stock = stock - allocated
      where id = variant_id;
    end if;

    insert into public.order_inventory_allocations (
      order_id, item_index, product_id, product_variant_id, sku,
      product_name, variant_name, requested_qty, allocated_qty,
      backorder_qty, stock_deducted_qty, released_qty, state, source,
      priority_at, allocated_at, last_allocated_at, released_at, updated_at
    ) values (
      target_order_id, item.item_index, product_id, variant_id, sku,
      coalesce(nullif(item.value ->> 'name', ''), product_name),
      coalesce(nullif(item.value ->> 'size', ''), variant_name),
      item_qty, allocated, missing, allocated, 0,
      case when missing = 0 then 'allocated' when allocated = 0 then 'backordered' else 'partial' end,
      'payment_allocation', now(),
      case when allocated > 0 then now() else null end,
      case when allocated > 0 then now() else null end,
      null, now()
    )
    on conflict (order_id, item_index) do update set
      product_id = excluded.product_id,
      product_variant_id = excluded.product_variant_id,
      sku = excluded.sku,
      product_name = excluded.product_name,
      variant_name = excluded.variant_name,
      requested_qty = excluded.requested_qty,
      allocated_qty = excluded.allocated_qty,
      backorder_qty = excluded.backorder_qty,
      stock_deducted_qty = excluded.stock_deducted_qty,
      state = excluded.state,
      source = excluded.source,
      priority_at = excluded.priority_at,
      allocated_at = excluded.allocated_at,
      last_allocated_at = excluded.last_allocated_at,
      released_at = null,
      updated_at = now()
    returning id into allocation_id;

    if allocated > 0 then
      insert into public.inventory_allocation_events (
        allocation_id, order_id, product_variant_id, event_type, quantity, actor_user_id
      ) values (
        allocation_id, target_order_id, variant_id, 'payment_allocate', allocated, auth.uid()
      );
    end if;

    perform public.sync_product_stock_mirror(product_id);
  end loop;
end;
$function$
$allocate_source$;
  before_security jsonb;
  after_security jsonb;
begin
  if md5(pg_get_functiondef('public.release_inventory_for_order(text)'::regprocedure)) <> 'dab521fe42a499e86a37830a91192d06'
    or md5(pg_get_functiondef('public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure)) <> '04d910b8e4ea85eb4abfdedec5445b72' then
    raise exception 'Compatibility install requires the captured legacy definitions; do not overwrite drift or rerun';
  end if;
  if not exists(select 1 from public.orders where id='ECL-20261103-155424-8308FA6E' and status='paid' and order_source='online'
    and total=24860 and jsonb_array_length(items)=7) then
    raise exception 'Compatibility install requires the original target order before supplementation';
  end if;
  select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'security_definer',prosecdef,'config',proconfig) order by oid)
    into before_security from pg_proc where oid in ('public.release_inventory_for_order(text)'::regprocedure,'public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure);
  execute release_def;
  execute allocate_def;
  select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'security_definer',prosecdef,'config',proconfig) order by oid)
    into after_security from pg_proc where oid in ('public.release_inventory_for_order(text)'::regprocedure,'public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure);
  if before_security is distinct from after_security then raise exception 'Compatibility must preserve function identity, owner, ACL and security configuration'; end if;
  if md5(pg_get_functiondef('public.release_inventory_for_order(text)'::regprocedure)) <> 'f29fbe0faea2e8b746eca6765306f853'
    or md5(pg_get_functiondef('public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure)) <> '5774550558ba91ac5035411099145937' then
    raise exception 'Installed definition hash mismatch';
  end if;
end;
$install$;

-- DRAFT / NOT EXECUTED. Only ECL-20261103-155424-8308FA6E.
-- Review README.md first. Production currently FAILS the inventory lifecycle gate.
-- Default is ROLLBACK. Never run as a migration or concatenate COMMIT after this file.
-- A separately reviewed lifecycle fix and fresh preflight are required before applying.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- DDL needs this lock. It also prevents concurrent writes to any order while the
-- two exact guards are temporarily disabled. Lock timeout aborts instead of waiting.
lock table public.orders in access exclusive mode;

do $supplement$
declare
  target constant text := 'ECL-20261103-155424-8308FA6E';
  operation_key constant text := 'one_off_1111_phase2_20261105_8308FA6E';
  reason constant text := '活動開始前已付款訂單，經營運指定一次性補贈第二彈兩檔滿額贈；豁免下單時間，不重算原優惠';
  plan constant jsonb := $plan$[{"promotion_id":"6a03c582-3102-4b0a-a063-229ea1e28b21","variant_id":38,"product_id":124,"qty":1,"sort_order":0,"name":"溫和增效潔面乳","size":"200ml","sku":"E95A","threshold":11111},{"promotion_id":"6a03c582-3102-4b0a-a063-229ea1e28b21","variant_id":87,"product_id":121,"qty":1,"sort_order":1,"name":"水嫩凍膜","size":"100g","sku":"Moisture Soothing Gel - E-92-1","threshold":11111},{"promotion_id":"44478b76-3cee-4157-918f-ecb4fc15f275","variant_id":104,"product_id":173,"qty":1,"sort_order":0,"name":"24k 金箔片（6入體驗組）","size":"6入","sku":"gold-6","threshold":22222},{"promotion_id":"44478b76-3cee-4157-918f-ecb4fc15f275","variant_id":105,"product_id":174,"qty":1,"sort_order":1,"name":"院線秘笈-金緞護理手冊","size":"1入","sku":"book-1","threshold":22222}]$plan$::jsonb;
  original_order public.orders%rowtype;
  final_order public.orders%rowtype;
  before_allocations jsonb;
  before_adjustments jsonb;
  before_reservations jsonb;
  config jsonb;
  trigger_state jsonb;
  gift_items jsonb := '[]';
  gift_adjustments jsonb := '[]';
  stocks_before jsonb;
  row_plan jsonb;
  gift jsonb;
  adj jsonb;
  variant public.product_variants%rowtype;
  product public.products%rowtype;
  qualification numeric;
  reserved integer;
  allocation_id bigint;
  line_index integer;
  at_time timestamptz := transaction_timestamp();
  expected_count integer := 4;
begin
  -- Allow only the exact order-specific compatibility definitions from compatibility-order.sql.
  -- These are NOT installed by this script; unknown definitions fail closed.
  if md5(pg_get_functiondef('public.release_inventory_for_order(text)'::regprocedure))
       <> 'f29fbe0faea2e8b746eca6765306f853'
     or md5(pg_get_functiondef('public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure))
       <> '5774550558ba91ac5035411099145937' then
    raise exception 'BLOCKED: production inventory lifecycle is not the reviewed exact-order compatible version. Do not bypass this check; review/fix separately and repeat preflight.';
  end if;
  if md5(pg_get_functiondef('public.protect_order_pricing_snapshot()'::regprocedure)) <> 'bd661ccdd1f1a9f70cefa7e7344ef4a2'
    or md5(pg_get_functiondef('public.sync_inventory_allocation_for_order()'::regprocedure)) <> '373a9378af91fa608663f25fdcd08705' then
    raise exception 'Order guard definitions changed; regenerate after read-only review';
  end if;
  select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by t.tgname)
  into trigger_state from pg_trigger t where t.tgrelid='public.orders'::regclass and not t.tgisinternal;
  if md5(trigger_state::text) <> '21c570d966753cd4c6d85b1884062f8b' then
    raise exception 'Order trigger inventory changed; regenerate after read-only review';
  end if;

  select * into strict original_order from public.orders where id=target for update;
  if original_order.status <> 'paid' or original_order.type <> 'pro' or original_order.order_source <> 'online' then
    raise exception 'Target must remain the reviewed paid, professional online order';
  end if;
  if md5(jsonb_build_object('items',original_order.items,'pricing_snapshot',original_order.pricing_snapshot,
      'subtotal',original_order.subtotal,'discount',original_order.discount,'total',original_order.total,
      'payment_amount',original_order.payment_amount,'shopping_credit_amount',original_order.shopping_credit_amount)::text)
      <> 'fbd928eab68e253199e6ebd7ac777c5a' then
    raise exception 'Order contents or prices changed since preflight';
  end if;
  if exists(select 1 from public.audit_logs where entity_id=target and metadata->>'operation_key'=operation_key)
    or exists(select 1 from public.order_adjustments where order_id=target and promotion_id in
      (select distinct (p->>'promotion_id')::uuid from jsonb_array_elements(plan) p))
    or exists(select 1 from public.promotion_gift_reservations where order_id=target and promotion_id in
      (select distinct (p->>'promotion_id')::uuid from jsonb_array_elements(plan) p))
    or exists(select 1 from jsonb_array_elements(original_order.items) i where i->>'promotion_id' in
      (select p->>'promotion_id' from jsonb_array_elements(plan) p)) then
    raise exception 'Supplement already exists or partial conflicting records found; refuse duplicate grant';
  end if;

  -- Prevent config/reward/scope changes during the single transaction.
  lock table public.promotions, public.promotion_gift_rewards, public.promotion_scopes in share mode;
  select jsonb_build_object(
    'promotions',(select jsonb_agg(to_jsonb(p) order by p.id) from public.promotions p where p.id in (select distinct (r->>'promotion_id')::uuid from jsonb_array_elements(plan) r)),
    'rewards',(select jsonb_agg(to_jsonb(r) order by r.promotion_id,r.sort_order) from public.promotion_gift_rewards r where r.promotion_id in (select distinct (p->>'promotion_id')::uuid from jsonb_array_elements(plan) p)),
    'scopes',(select jsonb_agg(to_jsonb(s) order by s.id) from public.promotion_scopes s where s.promotion_id in (select distinct (p->>'promotion_id')::uuid from jsonb_array_elements(plan) p)))
  into config;
  if md5(config::text) <> '2b59836fdf5fd0911b20813257de87dd' then raise exception 'Activity settings changed since preflight'; end if;
  if exists(select 1 from public.promotions where id in (select distinct (p->>'promotion_id')::uuid from jsonb_array_elements(plan) p)
    and (not active or archived_at is not null or start_at>at_time or end_at<=at_time)) then
    raise exception 'Reviewed activities must still be active now';
  end if;

  -- Same deterministic variant locking as the normal gift reservation path.
  perform 1 from public.product_variants where id in (select (p->>'variant_id')::bigint from jsonb_array_elements(plan) p) order by id for update;
  perform 1 from public.products where id in (select (p->>'product_id')::integer from jsonb_array_elements(plan) p) order by id for share;
  select jsonb_agg(jsonb_build_object('id',id,'stock',stock,'gift_stock',gift_stock) order by id)
    into stocks_before from public.product_variants where id in (select (p->>'variant_id')::bigint from jsonb_array_elements(plan) p);
  select coalesce(jsonb_agg(to_jsonb(a) order by item_index),'[]') into before_allocations from public.order_inventory_allocations a where order_id=target;
  select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') into before_adjustments from public.order_adjustments a where order_id=target;
  select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') into before_reservations from public.promotion_gift_reservations a where order_id=target;
  if jsonb_array_length(before_allocations)<>7 or
    (select sum((a->>'backorder_qty')::integer) from jsonb_array_elements(before_allocations) a)<>11 then
    raise exception 'Original allocation/backorder state changed; repeat preflight';
  end if;
  if md5(before_allocations::text)<>'8bf0e23196e78bc31f1cc62c35287da9'
    or md5(before_adjustments::text)<>'ca172d1a006d54ad400b570b29c5fe70'
    or md5(before_reservations::text)<>'7bddcf0261776a7a3cf97a301422513c' then
    raise exception 'Original allocation, adjustment or gift reservation drift; repeat preflight';
  end if;
  line_index := jsonb_array_length(original_order.items);

  for row_plan in select value from jsonb_array_elements(plan)
  loop
    select * into strict variant from public.product_variants where id=(row_plan->>'variant_id')::bigint;
    select * into strict product from public.products where id=variant.product_id;
    if not variant.active or not variant.gift_enabled or variant.product_id<>(row_plan->>'product_id')::integer
      or variant.sku is distinct from row_plan->>'sku' or variant.size is distinct from row_plan->>'size'
      or product.name_zh is distinct from row_plan->>'name'
      or product.publication_status not in ('active','event_only','gift_only') then
      raise exception 'Gift variant/catalog changed: %',row_plan->>'variant_id';
    end if;
    select coalesce(sum(quantity),0) into reserved from public.promotion_gift_reservations
      where product_variant_id=variant.id and status='reserved' and expires_at>at_time;
    if variant.gift_stock-reserved < (row_plan->>'qty')::integer then
      raise exception 'Insufficient unreserved gift stock for variant %',variant.id;
    end if;
    select coalesce(sum((i->>'line_total')::numeric),0) into qualification
      from jsonb_array_elements(original_order.items) i
      where coalesce(i->>'line_type','')<>'gift' and coalesce((i->>'is_gift')::boolean,false)=false
      and public.promotion_item_matches_scope((row_plan->>'promotion_id')::uuid,i,'qualification');
    if qualification<(row_plan->>'threshold')::numeric then raise exception 'Order below gift qualification threshold'; end if;
    gift:=jsonb_build_object('product_id',variant.product_id,'variant_id',variant.id,'sku',variant.sku,
      'name',product.name_zh,'nameZh',product.name_zh,'name_en',product.name,'size',variant.size,
      'qty',(row_plan->>'qty')::integer,'unit_price',0,'price',0,'line_total',0,'line_type','gift','is_gift',true,
      'promotion_id',row_plan->>'promotion_id','coupon_campaign_id',null,'image_storage_path',null,
      'stock_at_order',(row_plan->>'qty')::integer,'fulfillment_type','in_stock',
      'fulfillment_label','一次性補贈已配貨','shipping_label','與訂單一併出貨',
      'supplement_operation_key',operation_key);
    adj:=jsonb_build_object('promotion_id',row_plan->>'promotion_id','coupon_campaign_id',null,
      'adjustment_type','amount_gift','name',(select name from public.promotions where id=(row_plan->>'promotion_id')::uuid),
      'amount',0,'gift_product_id',variant.product_id,'gift_variant_id',variant.id,'gift_quantity',(row_plan->>'qty')::integer,
      'sort_order',200+line_index,'qualification',jsonb_build_object('basis','amount','value',qualification,
        'threshold',(row_plan->>'threshold')::numeric,'repeat_mode','once','repeat_count',1),
      'metadata',jsonb_build_object('source','one_time_supplement','operation_key',operation_key,'reason',reason,'granted_at',at_time,'waived_condition','original_order_before_activity_start'));
    gift_items:=gift_items||jsonb_build_array(gift);
    gift_adjustments:=gift_adjustments||jsonb_build_array(adj);

    -- Already paid: consume and allocate immediately; do not invoke the allocator
    -- for the whole order and do not change any existing allocation/item indexes.
    update public.product_variants set gift_stock=gift_stock-(row_plan->>'qty')::integer where id=variant.id;
    insert into public.promotion_gift_reservations(order_id,promotion_id,product_variant_id,quantity,status,reserved_at,expires_at,consumed_at)
      values(target,(row_plan->>'promotion_id')::uuid,variant.id,(row_plan->>'qty')::integer,'consumed',at_time,at_time,at_time);
    insert into public.order_inventory_allocations(order_id,item_index,product_id,product_variant_id,sku,product_name,variant_name,
      requested_qty,allocated_qty,backorder_qty,stock_deducted_qty,released_qty,state,source,line_type,promotion_id,
      priority_at,allocated_at,last_allocated_at)
      values(target,line_index,variant.product_id,variant.id,variant.sku,product.name_zh,variant.size,
        (row_plan->>'qty')::integer,(row_plan->>'qty')::integer,0,(row_plan->>'qty')::integer,0,
        'allocated','promotion_gift','gift',(row_plan->>'promotion_id')::uuid,at_time,at_time,at_time) returning id into allocation_id;
    insert into public.inventory_allocation_events(allocation_id,order_id,product_variant_id,event_type,quantity,actor_user_id)
      values(allocation_id,target,variant.id,'payment_allocate',(row_plan->>'qty')::integer,null);
    insert into public.order_adjustments(order_id,promotion_id,adjustment_type,name_snapshot,qualification_snapshot,amount,
      gift_product_id,gift_variant_id,gift_quantity,sort_order,metadata)
      values(target,(row_plan->>'promotion_id')::uuid,'amount_gift',adj->>'name',adj->'qualification',0,
        variant.product_id,variant.id,(row_plan->>'qty')::integer,200+line_index,adj->'metadata');
    line_index:=line_index+1;
  end loop;

  -- Only these two guards are suspended, under the exclusive orders lock.
  -- All audit, wallet, identity and shipping protections remain enabled.
  alter table public.orders disable trigger trg_protect_order_pricing_snapshot;
  alter table public.orders disable trigger trg_orders_inventory_allocation_sync;
  update public.orders set items=original_order.items||gift_items,
    pricing_snapshot=jsonb_set(jsonb_set(jsonb_set(original_order.pricing_snapshot,
      '{items}',original_order.pricing_snapshot->'items'||gift_items),
      '{gifts}',coalesce(original_order.pricing_snapshot->'gifts','[]')||gift_items),
      '{adjustments}',coalesce(original_order.pricing_snapshot->'adjustments','[]')||gift_adjustments)
      || jsonb_build_object('one_time_supplements',jsonb_build_array(jsonb_build_object(
        'operation_key',operation_key,'reason',reason,'granted_at',at_time,
        'original_snapshot_md5',md5(original_order.pricing_snapshot::text),'gifts',gift_items)))
    where id=target;
  alter table public.orders enable trigger trg_orders_inventory_allocation_sync;
  alter table public.orders enable trigger trg_protect_order_pricing_snapshot;

  select * into strict final_order from public.orders where id=target;
  if (to_jsonb(original_order)-array['items','pricing_snapshot','updated_at']) is distinct from
     (to_jsonb(final_order)-array['items','pricing_snapshot','updated_at'])
    or jsonb_array_length(final_order.items)<>11 then raise exception 'Unexpected order changes'; end if;
  if (select coalesce(jsonb_agg(to_jsonb(a) order by item_index),'[]') from public.order_inventory_allocations a where order_id=target and item_index<7) is distinct from before_allocations
    or (select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.order_adjustments a where order_id=target and id in(select (a->>'id')::bigint from jsonb_array_elements(before_adjustments) a)) is distinct from before_adjustments
    or (select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.promotion_gift_reservations a where order_id=target and id in(select (a->>'id')::bigint from jsonb_array_elements(before_reservations) a)) is distinct from before_reservations then
    raise exception 'Existing allocation, adjustment or reservation changed';
  end if;
  if exists(select 1 from public.product_variants v join jsonb_array_elements(stocks_before) b on v.id=(b->>'id')::bigint
    where v.stock<>(b->>'stock')::integer or v.gift_stock<>(b->>'gift_stock')::integer-1) then
    raise exception 'Incorrect stock delta';
  end if;
  if (select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by t.tgname)
      from pg_trigger t where t.tgrelid='public.orders'::regclass and not t.tgisinternal) is distinct from trigger_state then
    raise exception 'Order trigger state was not restored';
  end if;
  insert into public.audit_logs(actor_type,action,entity_type,entity_id,before_data,after_data,metadata)
    values('system','order.one_time_gift_supplement','orders',target,
      jsonb_build_object('item_count',7,'snapshot_md5',md5(original_order.pricing_snapshot::text)),
      jsonb_build_object('item_count',11,'gifts',gift_items),
      jsonb_build_object('operation_key',operation_key,'reason',reason,'source','reviewed_one_off_sql','gift_count',expected_count));
  raise notice 'Prepared supplement: four gifts, original amount %, original backorders 11. DEFAULT ROLLBACK.',final_order.total;
end;
$supplement$;

select id,status,total,payment_amount,jsonb_array_length(items) as item_count
from public.orders where id='ECL-20261103-155424-8308FA6E';
-- Leave as ROLLBACK until the separately reviewed prerequisite is installed,
-- a fresh preflight passes, and execution is explicitly authorized.
rollback;
