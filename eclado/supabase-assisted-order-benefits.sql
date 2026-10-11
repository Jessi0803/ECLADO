-- Run after supabase-assisted-orders.sql and the coupon/gift/shopping-credit migrations.
-- Additive: existing orders keep their snapshots; storefront pricing is not replaced.
begin;

alter table public.assisted_order_requests add column if not exists credit_consent_at timestamptz;
alter table public.assisted_order_requests add column if not exists credit_consent_amount bigint;

create or replace function public.assisted_coupon_allows_identity(p_campaign_id uuid,p_member_role text,p_customer_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select case campaign.audience_mode
    when 'members' then p_customer_id is not null and exists(select 1 from public.coupon_campaign_members target
      where target.coupon_campaign_id=campaign.id and target.user_id=p_customer_id)
    else p_member_role=any(campaign.audience_roles) and (p_customer_id is not null or campaign.allow_guest)
    end from public.coupon_campaigns campaign where campaign.id=p_campaign_id),false);
$$;
revoke all on function public.assisted_coupon_allows_identity(uuid,text,uuid) from public,anon,authenticated;

-- Clone the installed arithmetic, with explicit customer identity and canonical
-- custom-priced lines. No JWT impersonation, and no appendable shipping group.
do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure);
  if position('base_quote := public.quote_order_pricing(p_items, normalized_fulfillment);' in definition)=0
    or position('current_user_id uuid := auth.uid();' in definition)=0
    or (position('and not is_additional_order' in definition)=0 and position('and subtotal_amount - total_discount < 5000' in definition)=0) then
    raise exception 'Assisted discount engine source differs; migration stopped';
  end if;
  definition:=replace(definition,'quote_order_pricing_discount_v2(p_items jsonb, p_fulfillment_method text, p_coupon_code text, p_guest_email text)',
    'assisted_discount_quote(p_items jsonb, p_fulfillment_method text, p_coupon_code text, p_guest_email text, p_customer_id uuid, p_apply_automatic boolean)');
  definition:=replace(definition,'base_quote := public.quote_order_pricing(p_items, normalized_fulfillment);','base_quote := p_items;');
  definition:=replace(definition,'current_user_id uuid := auth.uid();','current_user_id uuid := p_customer_id;');
  -- ANY(subquery) otherwise compares an integer to an integer[] row, rather
  -- than expanding the array (the installed source may already include this cast).
  definition:=replace(definition,'(select product_ids from public.promotions where id = automatic_id)',
    '(select product_ids from public.promotions where id = automatic_id)::integer[]');
  definition:=replace(definition,'public.coupon_campaign_allows_identity(campaign.id, member_role)',
    'public.assisted_coupon_allows_identity(campaign.id, member_role, p_customer_id)');
  definition:=replace(definition,'where promotion.active = true','where p_apply_automatic and promotion.active = true');
  definition:=replace(definition,'shipping_group_context := public.get_my_appendable_shipping_group();','shipping_group_context := null;');
  definition:=replace(definition,'and not is_additional_order','and false -- minimum exceptions are validated by the assisted editor');
  definition:=replace(definition,'and subtotal_amount - total_discount < 5000','and false -- minimum exceptions are validated by the assisted editor');
  execute definition;
  definition:=pg_get_functiondef('public.quote_order_pricing(jsonb,text,text,text)'::regprocedure);
  if position('p_items, p_fulfillment_method, p_coupon_code, p_guest_email' in definition)=0 then
    raise exception 'Assisted gift engine source differs; migration stopped';
  end if;
  definition:=replace(definition,'quote_order_pricing(p_items jsonb, p_fulfillment_method text, p_coupon_code text, p_guest_email text)',
    'assisted_gift_quote(p_items jsonb, p_fulfillment_method text, p_coupon_code text, p_guest_email text, p_customer_id uuid, p_apply_automatic boolean)');
  definition:=replace(definition,'public.quote_order_pricing_discount_v2(','public.assisted_discount_quote(');
  definition:=replace(definition,'p_items, p_fulfillment_method, p_coupon_code, p_guest_email',
    'p_items, p_fulfillment_method, p_coupon_code, p_guest_email, p_customer_id, p_apply_automatic');
  definition:=replace(definition,$q$promotion.activation_type = 'automatic'$q$,$q$p_apply_automatic and promotion.activation_type = 'automatic'$q$);
  execute definition;
end $migration$;
revoke all on function public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean) from public,anon,authenticated;
revoke all on function public.assisted_gift_quote(jsonb,text,text,text,uuid,boolean) from public,anon,authenticated;

create or replace function public.quote_assisted_order(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare
  customer_id uuid; customer_role text:='consumer'; lines jsonb:='[]'; entry jsonb;
  product public.products%rowtype; variant public.product_variants%rowtype;
  quantity integer; price numeric; subtotal numeric:=0; legacy record;
  base jsonb; result jsonb; shipping numeric; default_shipping numeric; credit bigint;
  available bigint:=0; maximum bigint; automatic boolean; all_custom boolean:=true; confirmation_items jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write')
    or not public.has_backoffice_permission('members.read') or not public.has_backoffice_permission('catalog.read') then
    raise exception 'Admin order authorization required' using errcode='42501';
  end if;
  if p_payload->>'customer_type'='member' then
    customer_id:=(p_payload->>'member_id')::uuid;
    select role into customer_role from public.profiles where id=customer_id;
    if not found then raise exception 'Member not found' using errcode='22023'; end if;
    if customer_role not in ('pro','instructor','distributor','staff') then customer_role:='consumer'; end if;
  elsif p_payload->>'customer_type'<>'guest' or nullif(p_payload->>'member_id','') is not null then
    raise exception 'Select member or guest' using errcode='22023';
  end if;
  if (p_payload ? 'apply_automatic' and jsonb_typeof(p_payload->'apply_automatic') is distinct from 'boolean')
    or coalesce(p_payload->>'shopping_credit_amount','0') !~ '^[0-9]{1,10}$'
    or coalesce(length(p_payload->>'coupon_code'),0)>100 then
    raise exception 'Invalid assisted benefits' using errcode='22023';
  end if;
  -- Older admin clients never offered benefits. Keep their existing no-benefit behavior.
  automatic:=coalesce((p_payload->>'apply_automatic')::boolean,false);
  credit:=coalesce((p_payload->>'shopping_credit_amount')::bigint,0);
  if credit>0 and not public.has_backoffice_permission('shopping_credit.manage') then
    raise exception 'Shopping credit management permission required' using errcode='42501'; end if;
  if credit>0 and customer_id is null then raise exception '訪客不能使用購物金' using errcode='22023'; end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' then raise exception 'Items required' using errcode='22023'; end if;
  if jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'Invalid item count' using errcode='22023'; end if;
  if (select count(*) from jsonb_array_elements(p_payload->'items'))<>(select count(distinct x->>'variant_id') from jsonb_array_elements(p_payload->'items') x) then
    raise exception '同一規格請合併為一列。' using errcode='22023';
  end if;
  for entry in select value from jsonb_array_elements(p_payload->'items') loop
    if coalesce(entry->>'variant_id','') !~ '^[0-9]{1,18}$' or coalesce(entry->>'product_id','') !~ '^[0-9]{1,9}$'
      or coalesce(entry->>'qty','') !~ '^[0-9]{1,4}$' or coalesce(entry->>'unit_price','') !~ '^[0-9]{1,7}$' then
      raise exception 'Invalid item quantity or unit price' using errcode='22023'; end if;
    quantity:=(entry->>'qty')::integer; price:=(entry->>'unit_price')::numeric;
    if quantity<1 then raise exception 'Invalid quantity' using errcode='22023'; end if;
    select * into variant from public.product_variants where id=(entry->>'variant_id')::bigint
      and product_id=(entry->>'product_id')::integer and active;
    if not found then raise exception 'Product variant unavailable' using errcode='22023'; end if;
    select * into product from public.products where id=variant.product_id and active and publication_status='active';
    if not found or (product.is_pro_only and customer_role='consumer') then raise exception 'Product unavailable for customer' using errcode='22023'; end if;
    all_custom:=all_custom and coalesce(variant.is_custom_order,false);
    subtotal:=subtotal+quantity*price;
    lines:=lines||jsonb_build_array(jsonb_build_object('id',product.id,'product_id',product.id,'variant_id',variant.id,
      'sku',variant.sku,'name',product.name_zh,'nameZh',product.name_zh,'size',variant.size,'qty',quantity,
      'price',price,'unit_price',price,'line_total',price*quantity,'publication_status',product.publication_status,
      'is_custom_order',variant.is_custom_order,'stock_at_order',variant.stock,'line_type','merchandise',
      'fulfillment_type',case when variant.stock>=quantity then 'in_stock' else 'preorder' end));
  end loop;
  if p_payload->>'fulfillment_method' not in ('delivery','onsite_pickup')
    or (p_payload->>'fulfillment_method'='onsite_pickup' and not all_custom) then raise exception 'Invalid fulfillment method' using errcode='22023'; end if;
  base:=jsonb_build_object('items',lines,'subtotal',subtotal,'member_role',customer_role,'discount',0);
  if automatic then
    select p.id,p.name,round(eligible.amount-priced.amount) as discount,eligible.amount as eligible
    into legacy from public.promotions p cross join lateral (
      select coalesce(sum((x->>'line_total')::numeric),0) amount from jsonb_array_elements(lines) x
      where (x->>'product_id')::integer=any(p.product_ids)) eligible cross join lateral (
      select greatest(0,case p.discount_order when 'amount_then_rate' then
        (eligible.amount-p.discount_amount)*p.discount_rate else eligible.amount*p.discount_rate-p.discount_amount end) amount) priced
    where p.active and p.benefit_type='legacy_discount' and p.activation_type='automatic' and p.archived_at is null
      and (p.start_at is null or p.start_at<=now()) and (p.end_at is null or p.end_at>now())
      and p.discount_rate between 0 and 1 and p.discount_amount>=0 and eligible.amount>priced.amount
    order by discount desc,p.created_at,p.id limit 1;
    if found then base:=base||jsonb_build_object('discount',legacy.discount,'promotion_id',legacy.id,'promotion_name',legacy.name,
      'pricing_snapshot',jsonb_build_object('promotion',jsonb_build_object('eligible_subtotal',legacy.eligible))); end if;
  end if;
  result:=public.assisted_gift_quote(base,p_payload->>'fulfillment_method',p_payload->>'coupon_code',p_payload->>'email',customer_id,automatic);
  default_shipping:=(result->>'shipping')::numeric;
  case p_payload->>'shipping_mode'
    when 'default' then shipping:=default_shipping;
    when 'free' then shipping:=0;
    when 'custom' then
      if coalesce(p_payload->>'shipping_amount','') !~ '^[0-9]{1,7}$' then raise exception 'Invalid shipping' using errcode='22023'; end if;
      shipping:=(p_payload->>'shipping_amount')::numeric;
    else raise exception 'Invalid shipping mode' using errcode='22023';
  end case;
  if customer_id is not null and public.has_backoffice_permission('shopping_credit.manage') then
    select coalesce(available_balance,0) into available from public.shopping_credit_accounts where user_id=customer_id and status='active';
    available:=coalesce(available,0);
  end if;
  maximum:=greatest(0,least(available,floor(subtotal-(result->>'discount')::numeric),floor(subtotal-(result->>'discount')::numeric+shipping-1)));
  if credit>maximum then raise exception '購物金超過可用額度；不可支付運費，且銀行付款至少需 NT$1。' using errcode='22023'; end if;
  if subtotal-(result->>'discount')::numeric+shipping-credit<1 then raise exception '銀行付款至少需 NT$1。' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('variant_id',x->'variant_id','qty',x->'qty','unit_price',x->'unit_price',
    'line_type',x->'line_type','promotion_id',x->'promotion_id') order by n) into confirmation_items
    from jsonb_array_elements(result->'items') with ordinality as items(x,n);
  return result||jsonb_build_object('confirmation',jsonb_build_object('subtotal',subtotal,'discount',result->'discount',
      'shipping',shipping,'credit',credit,'coupon_campaign_id',result->'coupon_campaign_id','items',confirmation_items),
    'shipping',shipping,'default_shipping',default_shipping,
    'total',subtotal-(result->>'discount')::numeric+shipping,'shopping_credit_amount',credit,
    'payment_amount',subtotal-(result->>'discount')::numeric+shipping-credit,
    'available_credit',available,'maximum_credit',maximum);
end;
$$;
revoke all on function public.quote_assisted_order(jsonb) from public,anon;
grant execute on function public.quote_assisted_order(jsonb) to authenticated;

-- Keep the original immutable creator as a migration template, not an API.
do $migration$
declare definition text;
begin
  if to_regprocedure('public.create_assisted_order_base_v1(uuid,jsonb)') is null then
    definition:=pg_get_functiondef('public.create_assisted_order(uuid,jsonb)'::regprocedure);
    execute replace(definition,'create_assisted_order(','create_assisted_order_base_v1(');
  end if;
end $migration$;
revoke all on function public.create_assisted_order_base_v1(uuid,jsonb) from public,anon,authenticated;

create or replace function public.persist_assisted_benefits(p_order_id text,p_quote jsonb,p_customer_id uuid,p_email text)
returns void language plpgsql security definer set search_path=public,extensions as $$
declare gift jsonb; adjustment jsonb; expiry timestamptz; credit bigint;
begin
  select payment_due_at,shopping_credit_amount into expiry,credit from public.orders where id=p_order_id;
  if credit>0 then perform public.reserve_order_shopping_credit(p_customer_id,p_order_id,credit); end if;
  if nullif(p_quote->>'coupon_campaign_id','') is not null then
    insert into public.coupon_redemptions(coupon_campaign_id,order_id,user_id,guest_identity_hash,status,expires_at)
    values((p_quote->>'coupon_campaign_id')::uuid,p_order_id,p_customer_id,
      case when p_customer_id is null then encode(digest(lower(btrim(p_email)),'sha256'),'hex') end,'reserved',expiry);
  end if;
  for gift in select value from jsonb_array_elements(p_quote->'items') where value->>'line_type'='gift' loop
    insert into public.promotion_gift_reservations(order_id,promotion_id,coupon_campaign_id,product_variant_id,quantity,status,expires_at)
    values(p_order_id,(gift->>'promotion_id')::uuid,nullif(gift->>'coupon_campaign_id','')::uuid,(gift->>'variant_id')::bigint,(gift->>'qty')::integer,'reserved',expiry);
  end loop;
  for adjustment in select value from jsonb_array_elements(p_quote->'adjustments') loop
    -- Legacy activities have their own order promotion snapshot and are not
    -- accepted by the atomic-adjustment table's existing type constraint.
    if adjustment->>'adjustment_type'='legacy_discount' then continue; end if;
    insert into public.order_adjustments(order_id,promotion_id,coupon_campaign_id,adjustment_type,name_snapshot,qualification_snapshot,
      amount,gift_product_id,gift_variant_id,gift_quantity,sort_order,metadata)
    values(p_order_id,nullif(adjustment->>'promotion_id','')::uuid,nullif(adjustment->>'coupon_campaign_id','')::uuid,
      adjustment->>'adjustment_type',adjustment->>'name',coalesce(adjustment->'qualification','{}'),coalesce((adjustment->>'amount')::numeric,0),
      nullif(adjustment->>'gift_product_id','')::integer,nullif(adjustment->>'gift_variant_id','')::bigint,
      nullif(adjustment->>'gift_quantity','')::integer,coalesce((adjustment->>'sort_order')::integer,0),'{"source":"admin_assisted"}');
  end loop;
end;
$$;
revoke all on function public.persist_assisted_benefits(text,jsonb,uuid,text) from public,anon,authenticated;

-- Patch a copy of the original creator so validation, recovery, and audit rules
-- remain identical. All reservations and the order INSERT share one transaction.
do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public.create_assisted_order_base_v1(uuid,jsonb)'::regprocedure);
  if position('created_order_id text; snapshot jsonb;' in definition)=0
    or position('subtotal_amount+shipping_amount,0,case when method' in definition)=0 then
    raise exception 'Assisted creator source differs; migration stopped';
  end if;
  definition:=replace(definition,'create_assisted_order_base_v1(','create_assisted_order(');
  definition:=replace(definition,'created_order_id text; snapshot jsonb;','created_order_id text; snapshot jsonb; benefit_quote jsonb; benefit_discount numeric; credit_amount bigint; campaign_id uuid;');
  definition:=replace(definition,$q$'shipping_mode','shipping_amount','shipping_reason','minimum_reason']$q$,$q$'shipping_mode','shipping_amount','shipping_reason','minimum_reason','coupon_code','apply_automatic','shopping_credit_amount','expected_quote']$q$);
  -- Serialize coupon limits and gift stock. These are the same locks used by storefront creation.
  definition:=replace(definition,'-- Deterministic locks used by payment/FIFO allocation too.', $patch$
  if nullif(btrim(p_payload->>'coupon_code'),'') is not null then
    select id into campaign_id from public.coupon_campaigns where code_normalized=upper(btrim(p_payload->>'coupon_code'));
    if campaign_id is not null then perform pg_advisory_xact_lock(hashtextextended(campaign_id::text,0)); end if;
  end if;
  -- Deterministic locks used by payment/FIFO allocation too.$patch$);
  definition:=replace(definition,'if subtotal_amount<1 then', $patch$
  benefit_quote:=public.quote_assisted_order(p_payload);
  if p_payload ? 'expected_quote' and p_payload->'expected_quote' is distinct from benefit_quote->'confirmation' then
    raise exception '優惠、贈品或付款金額已變動，請重新計算並確認後再建立。' using errcode='40001';
  end if;
  benefit_discount:=(benefit_quote->>'discount')::numeric;
  credit_amount:=(benefit_quote->>'shopping_credit_amount')::bigint;
  lines:=benefit_quote->'items';
  if subtotal_amount<1 then$patch$);
  definition:=replace(definition,'and subtotal_amount<5000','and subtotal_amount-benefit_discount<5000');
  definition:=replace(definition,$q$from jsonb_array_elements(p_payload->'items') entry) order by id for update;$q$,
    $q$from jsonb_array_elements(p_payload->'items') entry) or id in (select gift_variant_id from public.promotions where active and benefit_type in ('amount_gift','quantity_gift')) order by id for update;$q$);
  definition:=replace(definition,'and subtotal_amount>=15000','and subtotal_amount-benefit_discount>=15000');
  definition:=replace(definition,$q$'subtotal',subtotal_amount,'discount',0,'shipping',shipping_amount,'total',subtotal_amount+shipping_amount,$q$,
    $q$'subtotal',subtotal_amount,'discount',benefit_discount,'shipping',shipping_amount,'total',subtotal_amount-benefit_discount+shipping_amount,$q$);
  definition:=replace(definition,$q$'shopping_credit_amount',0,'payment_amount',subtotal_amount+shipping_amount,'items',lines);$q$,
    $q$'shopping_credit_amount',credit_amount,'payment_amount',subtotal_amount-benefit_discount+shipping_amount-credit_amount,'items',lines)||jsonb_build_object('adjustments',benefit_quote->'adjustments','coupon',benefit_quote#>'{pricing_snapshot,coupon}','automatic_promotion',benefit_quote#>'{pricing_snapshot,automatic_promotion}','apply_automatic',p_payload->'apply_automatic');$q$);
  definition:=replace(definition,$q$perform set_config('app.eclado_order_shopping_credit_amount','0',true);$q$,
    $q$perform set_config('app.eclado_order_shopping_credit_amount',credit_amount::text,true);$q$);
  definition:=replace(definition,'pricing_snapshot,order_source,assisted_payment_method,payment_due_at)',
    'pricing_snapshot,order_source,assisted_payment_method,payment_due_at,promotion_id,promotion_name,coupon_campaign_id,coupon_name,coupon_code_mask)');
  definition:=replace(definition,'member_role,lines,subtotal_amount,0,subtotal_amount+shipping_amount,',
    'member_role,lines,subtotal_amount,benefit_discount,subtotal_amount-benefit_discount+shipping_amount,');
  definition:=replace(definition,'subtotal_amount+shipping_amount,0,case when method',
    'subtotal_amount-benefit_discount+shipping_amount-credit_amount,credit_amount,case when method');
  definition:=replace(definition,$q$snapshot,'admin_assisted',method,now()+interval '48 hours');$q$,
    $q$snapshot,'admin_assisted',method,now()+interval '48 hours',nullif(benefit_quote->>'promotion_id','')::uuid,benefit_quote->>'promotion_name',nullif(benefit_quote->>'coupon_campaign_id','')::uuid,benefit_quote->>'coupon_name',benefit_quote->>'coupon_code_mask');$q$);
  definition:=replace(definition,$q$perform set_config('app.assisted_order_create','0',true);$q$,
    $q$perform set_config('app.assisted_order_create','0',true); perform set_config('app.eclado_order_shopping_credit_amount','0',true); perform public.persist_assisted_benefits(created_order_id,benefit_quote,member_id,p_payload->>'email');$q$);
  definition:=replace(definition,$q$'recovered',false)$q$,$q$'recovered',false,'shopping_credit_amount',credit_amount)$q$);
  definition:=replace(definition,$q$'recovered',true)$q$,$q$'recovered',true,'shopping_credit_amount',(select shopping_credit_amount from public.orders where id=request_row.order_id))$q$);
  execute definition;
end $migration$;

-- Merchandise is allocated at creation; gifts remain reserved until payment.
-- Preserve array indices when allocating only one line type.
-- Purpose-specific functions also support installations where the original
-- inventory engine still handles merchandise only. Do not replace that engine.
do $migration$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.order_inventory_allocations'::regclass
      and conname='order_inventory_allocations_source_check';
  if definition is not null and position('promotion_gift' in definition)=0 then
    if left(definition,7)<>'CHECK (' or right(definition,1)<>')' then raise exception 'Inventory source constraint differs'; end if;
    alter table public.order_inventory_allocations drop constraint order_inventory_allocations_source_check;
    execute 'alter table public.order_inventory_allocations add constraint order_inventory_allocations_source_check CHECK (('
      ||substr(definition,8,length(definition)-8)||') OR source=''promotion_gift'')';
  end if;
end $migration$;
create or replace function public.allocate_assisted_inventory(target_order_id text, order_items jsonb, p_gifts boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item record; item_qty integer; variant_id bigint; available_qty integer;
  allocated integer; missing integer; allocation_id bigint; product_id integer;
  sku text; product_name text; variant_name text; gift_reservation record;
  is_gift boolean;
begin
  if order_items is null or jsonb_typeof(order_items) <> 'array' then
    raise exception 'Order items must be an array' using errcode = '22023';
  end if;
  perform 1 from public.product_variants variant where variant.id in (
    select (entry.value ->> 'variant_id')::bigint from jsonb_array_elements(order_items) entry
    where coalesce(entry.value ->> 'variant_id', '') ~ '^[0-9]+$'
  ) order by variant.id for update;

  for item in select value, (ordinality - 1)::integer item_index
    from jsonb_array_elements(order_items) with ordinality
  loop
    item_qty := coalesce(nullif(item.value ->> 'qty', '')::integer, 0);
    if item_qty <= 0 then raise exception 'Invalid quantity on order % item %', target_order_id, item.item_index using errcode='22023'; end if;
    variant_id := case
      when coalesce(item.value ->> 'variant_id', '') ~ '^[0-9]+$'
        then (item.value ->> 'variant_id')::bigint
      else null
    end;
    is_gift := coalesce(item.value ->> 'line_type', '') = 'gift' or coalesce((item.value ->> 'is_gift')::boolean, false);
    if is_gift is distinct from p_gifts then continue; end if;

    -- Keep the pre-variant compatibility path for legacy merchandise orders.
    -- Promotion gifts always carry an explicit gift-enabled variant.
    if variant_id is null and not is_gift then
      select variant.id into variant_id
      from public.product_variants variant
      where variant.product_id = nullif(item.value ->> 'id', '')::integer
        and variant.active = true
      order by variant.is_default desc, variant.sort_order, variant.id
      limit 1;
    end if;

    select variant.product_id,
      variant.sku,
      variant.size,
      case when is_gift then variant.gift_stock else variant.stock end,
      product.name_zh
    into product_id, sku, variant_name, available_qty, product_name
    from public.product_variants variant join public.products product on product.id = variant.product_id
    where variant.id = variant_id for update of variant;
    if not found then raise exception 'Product variant is missing for order % item %', target_order_id, item.item_index using errcode='P0002'; end if;

    if is_gift then
      select reservation.* into gift_reservation
      from public.promotion_gift_reservations reservation
      where reservation.order_id = target_order_id
        and reservation.promotion_id = (item.value ->> 'promotion_id')::uuid
        and reservation.product_variant_id = variant_id
        and reservation.status = 'reserved'
        and reservation.expires_at > now()
      for update;
      if not found or gift_reservation.quantity <> item_qty or available_qty < item_qty then
        raise exception '贈品庫存保留資料不完整，無法完成付款' using errcode='55000';
      end if;
      allocated := item_qty; missing := 0;
      update public.promotion_gift_reservations set status='consumed', consumed_at=now()
      where id = gift_reservation.id;
      update public.product_variants set gift_stock = gift_stock - item_qty where id = variant_id;
    else
      allocated := least(item_qty, greatest(coalesce(available_qty,0),0));
      missing := item_qty - allocated;
      if allocated > 0 then update public.product_variants set stock=stock-allocated where id=variant_id; end if;
    end if;

    insert into public.order_inventory_allocations (
      order_id,item_index,product_id,product_variant_id,sku,product_name,variant_name,
      requested_qty,allocated_qty,backorder_qty,stock_deducted_qty,released_qty,state,source,
      line_type,promotion_id,coupon_campaign_id,priority_at,allocated_at,last_allocated_at,updated_at
    ) values (
      target_order_id,item.item_index,product_id,variant_id,sku,
      coalesce(nullif(item.value->>'name',''),product_name),coalesce(nullif(item.value->>'size',''),variant_name),
      item_qty,allocated,missing,allocated,0,
      case when missing=0 then 'allocated' when allocated=0 then 'backordered' else 'partial' end,
      case when is_gift then 'promotion_gift' else 'payment_allocation' end,
      case when is_gift then 'gift' else 'merchandise' end,
      nullif(item.value->>'promotion_id','')::uuid,nullif(item.value->>'coupon_campaign_id','')::uuid,
      now(),case when allocated>0 then now() end,case when allocated>0 then now() end,now()
    ) on conflict (order_id,item_index) do update set
      requested_qty=excluded.requested_qty,allocated_qty=excluded.allocated_qty,
      backorder_qty=excluded.backorder_qty,stock_deducted_qty=excluded.stock_deducted_qty,
      state=excluded.state,source=excluded.source,line_type=excluded.line_type,
      promotion_id=excluded.promotion_id,coupon_campaign_id=excluded.coupon_campaign_id,
      allocated_at=excluded.allocated_at,last_allocated_at=excluded.last_allocated_at,
      released_at=null,updated_at=now()
    returning id into allocation_id;
    if allocated > 0 then
      insert into public.inventory_allocation_events(allocation_id,order_id,product_variant_id,event_type,quantity,actor_user_id)
      values(allocation_id,target_order_id,variant_id,'payment_allocate',allocated,auth.uid());
    end if;
    if not is_gift then
      perform public.sync_product_stock_mirror(product_id);
    end if;
  end loop;
end;
$$;

create or replace function public.release_assisted_inventory(target_order_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allocation record;
begin
  perform 1
  from public.product_variants variant
  where variant.id in (
    select item.product_variant_id
    from public.order_inventory_allocations item
    where item.order_id = target_order_id and item.state <> 'released'
  )
  order by variant.id
  for update;

  for allocation in
    select *
    from public.order_inventory_allocations
    where order_id = target_order_id and state <> 'released'
    order by product_variant_id, item_index
    for update
  loop
    if allocation.stock_deducted_qty > 0 then
      if allocation.line_type = 'gift' then
        update public.product_variants
        set gift_stock = gift_stock + allocation.stock_deducted_qty
        where id = allocation.product_variant_id;
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
    set released_qty = released_qty + allocated_qty,
        allocated_qty = 0,
        backorder_qty = 0,
        stock_deducted_qty = 0,
        state = 'released',
        released_at = now(),
        updated_at = now()
    where id = allocation.id;

    if allocation.line_type <> 'gift' then
      perform public.sync_product_stock_mirror(allocation.product_id);
    end if;
  end loop;
end;
$$;
revoke all on function public.release_assisted_inventory(text) from public,anon,authenticated;
revoke all on function public.allocate_assisted_inventory(text,jsonb,boolean) from public,anon,authenticated;
create or replace function public.sync_assisted_inventory()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    perform public.allocate_assisted_inventory(new.id,new.items,false);
  elsif new.items is distinct from old.items then raise exception 'Assisted order items are locked' using errcode='55000';
  elsif old.status='cancelled' and new.status='paid' then
    perform public.allocate_assisted_inventory(new.id,new.items,false);
    -- Verified late payment uses the existing strict gift-stock checks.
    update public.promotion_gift_reservations set status='reserved',expires_at=now()+interval '5 minutes'
      where order_id=new.id and status='released';
    perform public.allocate_assisted_inventory(new.id,new.items,true);
  elsif new.status in ('paid','preparing','ready_for_pickup','picked_up','shipped','delivered') and old.status in ('unpaid','awaiting_confirm') then
    perform public.allocate_assisted_inventory(new.id,new.items,true);
  elsif new.status in ('cancelled','returned') and old.status not in ('cancelled','returned') then
    perform public.release_assisted_inventory(new.id);
  end if;
  if new.status in ('ready_for_pickup','picked_up','shipped','delivered') then perform public.close_backorders_for_fulfillment(new.id); end if;
  return new;
end;
$$;

create or replace function public.assert_assisted_credit_consent(p_order_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.orders o where o.id=p_order_id and o.order_source='admin_assisted' and o.shopping_credit_amount>0
    and not exists(select 1 from public.assisted_order_requests r where r.order_id=o.id
      and r.credit_consent_at is not null and r.credit_consent_amount=o.shopping_credit_amount)) then
    raise exception '請先由客戶確認並同意使用購物金。' using errcode='42501';
  end if;
end;
$$;
revoke all on function public.assert_assisted_credit_consent(text) from public,anon,authenticated;

create or replace function public.confirm_assisted_credit_consent(p_order_id text,p_link_token text,p_amount bigint)
returns void language plpgsql security definer set search_path='' as $$
declare target public.orders%rowtype;
begin
  perform public.authorize_assisted_link(p_order_id,p_link_token);
  select * into target from public.orders where id=p_order_id for update;
  if target.status not in ('unpaid','awaiting_confirm') or target.payment_due_at<=now()
    or p_amount is distinct from target.shopping_credit_amount or p_amount<=0 then
    raise exception '購物金同意金額或訂單狀態不正確。' using errcode='22023'; end if;
  update public.assisted_order_requests set credit_consent_at=coalesce(credit_consent_at,now()),credit_consent_amount=p_amount where order_id=p_order_id;
end;
$$;
revoke all on function public.confirm_assisted_credit_consent(text,text,bigint) from public,anon,authenticated;
grant execute on function public.confirm_assisted_credit_consent(text,text,bigint) to service_role;
grant execute on function public.assert_assisted_credit_consent(text) to service_role;

-- Gate every bank claim/retry, not just the customer confirmation endpoint.
do $migration$
declare signature text; definition text;
begin
  foreach signature in array array['public.claim_order_payment(text,text)','public.begin_order_payment_retry(text)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position('public.assert_assisted_credit_consent(p_order_id)' in definition)=0 then
      definition:=replace(definition,E'begin\n',E'begin\n  perform public.assert_assisted_credit_consent(p_order_id);\n');
      if position('public.assert_assisted_credit_consent(p_order_id)' in definition)=0 then raise exception 'Payment guard source differs'; end if;
      execute definition;
    end if;
  end loop;
end $migration$;

-- Recovery also needs the authoritative credit amount; never call the bank from
-- the admin dialog for an order awaiting customer consent.
do $migration$
declare signature text; definition text;
begin
  foreach signature in array array['public.get_admin_assisted_link(text)','public.get_admin_assisted_request(uuid)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position($q$'shopping_credit_amount'$q$ in definition)=0 then
      definition:=replace(definition,$q$'link_token',link_token$q$,$q$'link_token',link_token,'shopping_credit_amount',(select shopping_credit_amount from public.orders where id=order_id)$q$);
      execute definition;
    end if;
  end loop;
end $migration$;

do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public.authorize_assisted_link(text,text)'::regprocedure);
  if position($q$'credit_consent_at'$q$ in definition)=0 then
    definition:=replace(definition,$q$'payment_method',target_order.assisted_payment_method)$q$,
      $q$'payment_method',target_order.assisted_payment_method,'credit_consent_at',request_row.credit_consent_at)$q$);
    execute definition;
  end if;
end $migration$;
notify pgrst,'reload schema';
commit;
