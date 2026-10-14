-- Recovery only after separate approval. Keep flag OFF; restore frontend first.
begin;
update public.student_pricing_feature_settings set enabled=false,version=version+1,updated_at=now() where singleton;
CREATE OR REPLACE FUNCTION public.create_assisted_order(p_request_key uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  request_row public.assisted_order_requests%rowtype;
  member_id uuid; member_role text := 'consumer';
  target_variant public.product_variants%rowtype; target_product public.products%rowtype;
  item jsonb; lines jsonb := '[]'::jsonb; quantity integer; unit_price numeric;
  suggested_price numeric; suggested_prices jsonb := '[]'::jsonb; subtotal_amount numeric := 0; shipping_amount numeric;
  default_shipping numeric; method text; delivery text; all_custom boolean := true; all_free boolean := true;
  created_order_id text; snapshot jsonb; benefit_quote jsonb; benefit_discount numeric; credit_amount bigint; campaign_id uuid;
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write')
    or not public.has_backoffice_permission('members.read')
    or not public.has_backoffice_permission('catalog.read') then
    raise exception 'Admin order authorization required' using errcode='42501';
  end if;
  if p_request_key is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or (p_payload - array['customer_type','member_id','member','phone','email','address','note','items',
      'payment_method','fulfillment_method','invoice_type','invoice_company_name','invoice_tax_id',
      'shipping_mode','shipping_amount','shipping_reason','minimum_reason','coupon_code','apply_automatic','shopping_credit_amount','expected_quote'])<>'{}'::jsonb then
    raise exception 'Invalid assisted order payload' using errcode='22023';
  end if;
  insert into public.assisted_order_requests(request_key,actor_user_id,payload,payment_token,link_token)
  values (p_request_key,auth.uid(),p_payload,encode(gen_random_bytes(32),'hex'),encode(gen_random_bytes(32),'hex'))
  on conflict(request_key) do nothing;
  select * into request_row from public.assisted_order_requests where request_key=p_request_key for update;
  if request_row.actor_user_id<>auth.uid() then raise exception 'Request owner mismatch' using errcode='42501'; end if;
  if request_row.payload is distinct from p_payload then
    raise exception '同一次開單內容不同，請找回原單確認後取消重建。' using errcode='22023';
  end if;
  if request_row.order_id is not null then
    return jsonb_build_object('order_id',request_row.order_id,'link_token',request_row.link_token,'recovered',true,'shopping_credit_amount',(select shopping_credit_amount from public.orders where id=request_row.order_id));
  end if;
  if p_payload->>'customer_type'='member' then
    member_id := (p_payload->>'member_id')::uuid;
    select role into member_role from public.profiles where id=member_id;
    if not found then raise exception 'Member not found' using errcode='22023'; end if;
    if member_role not in ('pro','instructor','distributor','staff') then member_role := 'consumer'; end if;
  elsif p_payload->>'customer_type'='guest' and nullif(p_payload->>'member_id','') is null then
    member_id := null;
  else raise exception 'Select member or guest' using errcode='22023'; end if;
  method := p_payload->>'payment_method'; delivery := p_payload->>'fulfillment_method';
  if method is null or method not in ('card','atm','apple','google') or delivery is null or delivery not in ('delivery','onsite_pickup') then
    raise exception 'Invalid payment or fulfillment method' using errcode='22023';
  end if;
  if coalesce(length(btrim(p_payload->>'member')),0) not between 1 and 100
    or coalesce(p_payload->>'phone','') !~ '^[0-9+() -]{9,20}$'
    or coalesce(p_payload->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(p_payload->>'email')>254
    or (delivery='delivery' and coalesce(length(btrim(p_payload->>'address')),0) not between 1 and 500)
    or length(coalesce(p_payload->>'note',''))>1000 then
    raise exception '請完整填寫收件姓名、手機、Email 與地址。' using errcode='22023';
  end if;
  if coalesce(p_payload->>'invoice_type','') not in ('personal','company')
    or (p_payload->>'invoice_type'='company' and (
      coalesce(length(btrim(p_payload->>'invoice_company_name')),0) not between 1 and 200
      or coalesce(p_payload->>'invoice_tax_id','') !~ '^[0-9]{8}$')) then
    raise exception 'Invalid invoice snapshot' using errcode='22023';
  end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' then raise exception 'Items required' using errcode='22023'; end if;
  if jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'Invalid item count' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'items') entry where
    coalesce(entry->>'variant_id','') !~ '^[0-9]{1,18}$' or coalesce(entry->>'product_id','') !~ '^[0-9]{1,9}$'
    or coalesce(entry->>'qty','') !~ '^[0-9]{1,4}$' or coalesce(entry->>'unit_price','') !~ '^[0-9]{1,7}$') then
    raise exception 'Invalid item quantity or unit price' using errcode='22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_payload->'items')) <> (select count(distinct entry->>'variant_id') from jsonb_array_elements(p_payload->'items') entry) then
    raise exception '同一規格請合併為一列。' using errcode='22023';
  end if;

  if nullif(btrim(p_payload->>'coupon_code'),'') is not null then
    select id into campaign_id from public.coupon_campaigns where code_normalized=upper(btrim(p_payload->>'coupon_code'));
    if campaign_id is not null then perform pg_advisory_xact_lock(hashtextextended(campaign_id::text,0)); end if;
  end if;
  -- Deterministic locks used by payment/FIFO allocation too.
  perform 1 from public.product_variants where id in (select (entry->>'variant_id')::bigint
    from jsonb_array_elements(p_payload->'items') entry) or id in (select gift_variant_id from public.promotions where active and benefit_type in ('amount_gift','quantity_gift')) order by id for update;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
    quantity := (item->>'qty')::integer; unit_price := (item->>'unit_price')::numeric;
    if quantity<1 then raise exception 'Quantity must be positive' using errcode='22023'; end if;
    select * into target_variant from public.product_variants where id=(item->>'variant_id')::bigint
      and product_id=(item->>'product_id')::integer and active is true;
    if not found then raise exception 'Product variant unavailable' using errcode='22023'; end if;
    select * into target_product from public.products where id=target_variant.product_id
      and active is true and publication_status='active';
    if not found or (target_product.is_pro_only and member_role='consumer') then
      raise exception 'Product unavailable for this customer' using errcode='22023';
    end if;
    if not target_variant.is_custom_order and target_variant.stock<quantity then
      raise exception '商品 % % 現貨不足，請調整數量。',target_product.name_zh,target_variant.size using errcode='22023';
    end if;
    all_custom := all_custom and coalesce(target_variant.is_custom_order,false);
    all_free := all_free and target_product.id=9;
    suggested_price := case when member_role='consumer' then target_variant.price else
      round((case when (member_role='instructor' and target_product.instructor_price_multiplier=1)
        or (member_role='distributor' and target_product.distributor_price_multiplier=1)
        or (member_role='staff' and target_product.staff_price_multiplier=1)
        or (member_role='pro' and target_product.instructor_price_multiplier=1
          and target_product.distributor_price_multiplier=1 and target_product.staff_price_multiplier=1)
        then coalesce(target_variant.pro_price,0) else coalesce(nullif(target_variant.pro_price,0),target_variant.price) end)
        *public.resolve_product_price_multiplier(
        target_product,member_role,coalesce((select professional_price_multiplier from public.membership_tiers where role=member_role and active),1))) end;
    suggested_prices := suggested_prices || jsonb_build_array(jsonb_build_object('variant_id',target_variant.id,
      'suggested_unit_price',suggested_price,'final_unit_price',unit_price,'member_role',member_role));
    subtotal_amount := subtotal_amount+unit_price*quantity;
    lines := lines || jsonb_build_array(jsonb_build_object(
      'product_id',target_product.id,'id',target_product.id,'variant_id',target_variant.id,
      'sku',target_variant.sku,'name',target_product.name_zh,'nameZh',target_product.name_zh,
      'size',target_variant.size,'qty',quantity,'price',unit_price,'unit_price',unit_price,'line_total',unit_price*quantity,
      'is_custom_order',target_variant.is_custom_order,'stock_at_order',target_variant.stock,
      'fulfillment_type',case when target_variant.stock>=quantity then 'in_stock' else 'preorder' end));
  end loop;

  benefit_quote:=public.quote_assisted_order(p_payload);
  if p_payload ? 'expected_quote' and p_payload->'expected_quote' is distinct from benefit_quote->'confirmation' then
    raise exception '優惠、贈品或付款金額已變動，請重新計算並確認後再建立。' using errcode='40001';
  end if;
  benefit_discount:=(benefit_quote->>'discount')::numeric;
  credit_amount:=(benefit_quote->>'shopping_credit_amount')::bigint;
  lines:=benefit_quote->'items';
  if subtotal_amount<1 then raise exception 'Order requires at least NT$1 payment' using errcode='22023'; end if;
  if delivery='onsite_pickup' and not all_custom then raise exception 'Only custom-order products support pickup' using errcode='22023'; end if;
  if member_role in ('pro','instructor','distributor','staff') and subtotal_amount-benefit_discount<5000
    and coalesce(length(btrim(p_payload->>'minimum_reason')),0) not between 1 and 1000 then
    raise exception '低於最低訂購額，請填寫例外原因。' using errcode='22023';
  end if;
  default_shipping := case when delivery='onsite_pickup' or member_role='staff' or all_free
    or (member_role in ('pro','instructor','distributor') and subtotal_amount-benefit_discount>=15000) then 0 else 120 end;
  case p_payload->>'shipping_mode'
    when 'default' then shipping_amount := default_shipping;
    when 'free' then shipping_amount := 0;
    when 'custom' then
      if coalesce(p_payload->>'shipping_amount','') !~ '^[0-9]{1,7}$' then raise exception 'Invalid shipping amount' using errcode='22023'; end if;
      shipping_amount := (p_payload->>'shipping_amount')::numeric;
    else raise exception 'Invalid shipping mode' using errcode='22023';
  end case;
  if shipping_amount<>default_shipping and coalesce(length(btrim(p_payload->>'shipping_reason')),0) not between 1 and 1000 then
    raise exception '運費異動需填寫原因。' using errcode='22023';
  end if;
  created_order_id := 'ECL-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-')||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  snapshot := jsonb_build_object('version',1,'source','admin_assisted','member_role',member_role,
    'subtotal',subtotal_amount,'discount',benefit_discount,'shipping',shipping_amount,'total',subtotal_amount-benefit_discount+shipping_amount,
    'shopping_credit_amount',credit_amount,'payment_amount',subtotal_amount-benefit_discount+shipping_amount-credit_amount,'items',lines)||jsonb_build_object('adjustments',benefit_quote->'adjustments','coupon',benefit_quote#>'{pricing_snapshot,coupon}','automatic_promotion',benefit_quote#>'{pricing_snapshot,automatic_promotion}','apply_automatic',p_payload->'apply_automatic');
  perform set_config('app.assisted_order_create','1',true);
  perform set_config('app.eclado_order_shopping_credit_amount',credit_amount::text,true);
  insert into public.orders(id,user_id,member,type,items,subtotal,discount,total,payment_amount,shopping_credit_amount,
    status,date,address,phone,email,note,fulfillment_method,invoice_type,invoice_company_name,invoice_tax_id,
    pricing_snapshot,order_source,assisted_payment_method,payment_due_at,promotion_id,promotion_name,coupon_campaign_id,coupon_name,coupon_code_mask)
  values (created_order_id,member_id,btrim(p_payload->>'member'),member_role,lines,subtotal_amount,benefit_discount,subtotal_amount-benefit_discount+shipping_amount,
    subtotal_amount-benefit_discount+shipping_amount-credit_amount,credit_amount,case when method='atm' then 'awaiting_confirm' else 'unpaid' end,
    (now() at time zone 'Asia/Taipei')::date::text,coalesce(p_payload->>'address',''),p_payload->>'phone',p_payload->>'email',
    coalesce(p_payload->>'note',''),delivery,p_payload->>'invoice_type',
    case when p_payload->>'invoice_type'='company' then p_payload->>'invoice_company_name' end,
    case when p_payload->>'invoice_type'='company' then p_payload->>'invoice_tax_id' end,
    snapshot,'admin_assisted',method,now()+interval '48 hours',nullif(benefit_quote->>'promotion_id','')::uuid,benefit_quote->>'promotion_name',nullif(benefit_quote->>'coupon_campaign_id','')::uuid,benefit_quote->>'coupon_name',benefit_quote->>'coupon_code_mask');
  perform set_config('app.assisted_order_create','0',true); perform set_config('app.eclado_order_shopping_credit_amount','0',true); perform public.persist_assisted_benefits(created_order_id,benefit_quote,member_id,p_payload->>'email');
  insert into public.order_payment_authorizations(order_id,token_hash,provider_order_no,attempt_no)
    values(created_order_id,encode(digest(request_row.payment_token,'sha256'),'hex'),created_order_id,1);
  update public.assisted_order_requests set order_id=created_order_id,pricing_context=suggested_prices where request_key=p_request_key;
  return jsonb_build_object('order_id',created_order_id,'link_token',request_row.link_token,'recovered',false,'shopping_credit_amount',credit_amount);
end;
$function$;
revoke all on function public.create_assisted_order(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_assisted_order(uuid,jsonb) to postgres,service_role;
grant execute on function public.create_assisted_order(uuid,jsonb) to authenticated;
CREATE OR REPLACE FUNCTION public.quote_assisted_order(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
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
      'image_storage_path',(select image.storage_path from public.product_images image where image.product_id=product.id and image.active is true order by image.is_primary desc,image.sort_order,image.id limit 1),
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
$function$;
revoke all on function public.quote_assisted_order(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quote_assisted_order(jsonb) to postgres,service_role;
grant execute on function public.quote_assisted_order(jsonb) to authenticated;
CREATE OR REPLACE FUNCTION public.quote_order_pricing_internal_20260916(p_items jsonb, p_fulfillment_method text DEFAULT 'delivery'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  current_user_id uuid := auth.uid();
  member_role text := 'consumer';
  tier public.membership_tiers%rowtype;
  requested_item record;
  product_row public.products%rowtype;
  variant_row public.product_variants%rowtype;
  requested_variant text;
  quantity integer;
  list_price numeric;
  professional_price numeric;
  unit_price numeric;
  item_stock integer;
  item_size text;
  order_items jsonb := '[]'::jsonb;
  subtotal_amount numeric := 0;
  discount_amount numeric := 0;
  shipping_amount numeric := 120;
  total_amount numeric := 0;
  selected_promotion_id uuid;
  selected_promotion_name text;
  selected_promotion_rate numeric;
  selected_promotion_amount numeric;
  selected_promotion_order text;
  selected_promotion_subtotal numeric := 0;
  selected_promotion_final_subtotal numeric := 0;
  pricing_snapshot jsonb;
  normalized_fulfillment_method text := coalesce(nullif(trim(p_fulfillment_method), ''), 'delivery');
  all_custom_order_items boolean := true;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many cart items' using errcode = '22023';
  end if;

  if normalized_fulfillment_method not in ('delivery', 'onsite_pickup') then
    raise exception 'Invalid fulfillment method' using errcode = '22023';
  end if;

  if current_user_id is not null then
    select coalesce(role, 'consumer')
      into member_role
      from public.profiles
      where id = current_user_id;
    member_role := coalesce(member_role, 'consumer');
  end if;

  select *
    into tier
    from public.membership_tiers
    where role = member_role and active = true;

  if not found then
    select *
      into tier
      from public.membership_tiers
      where role = 'consumer' and active = true;
    member_role := 'consumer';
  end if;

  for requested_item in
    select value from jsonb_array_elements(p_items)
  loop
    quantity := nullif(requested_item.value ->> 'qty', '')::integer;
    if quantity is null or quantity < 1 or quantity > 99 then
      raise exception 'Invalid quantity' using errcode = '22023';
    end if;

    select *
      into product_row
      from public.products
      where id = nullif(requested_item.value ->> 'product_id', '')::integer
        and publication_status in ('active', 'event_only');

    if not found then
      raise exception 'Product not found or inactive' using errcode = 'P0002';
    end if;

    if product_row.is_pro_only and not tier.can_buy_pro_products then
      raise exception 'Professional membership required for product %', product_row.id
        using errcode = '42501';
    end if;

    requested_variant := nullif(trim(requested_item.value ->> 'variant_id'), '');
    if requested_variant is null then
      select *
        into variant_row
        from public.product_variants
        where product_id = product_row.id
          and active = true
          and is_default = true
        order by sort_order asc, id asc
        limit 1;
    else
      select *
        into variant_row
        from public.product_variants
        where product_id = product_row.id
          and active = true
          and (
            id::text = requested_variant
            or sku = requested_variant
            or size = requested_variant
          )
        order by is_default desc, sort_order asc, id asc
        limit 1;
    end if;

    if not found then
      raise exception 'Active product variant not found for product %', product_row.id
        using errcode = 'P0002';
    end if;

    requested_variant := variant_row.id::text;
    list_price := variant_row.price;
    professional_price := variant_row.pro_price;
    item_stock := greatest(coalesce(variant_row.stock, 0), 0);
    item_size := variant_row.size;
    all_custom_order_items := all_custom_order_items and variant_row.is_custom_order;

    if tier.professional_price_multiplier is null then
      unit_price := list_price;
    else
      unit_price := round(
        case when
          (member_role='instructor' and product_row.instructor_price_multiplier=1)
          or (member_role='distributor' and product_row.distributor_price_multiplier=1)
          or (member_role='staff' and product_row.staff_price_multiplier=1)
          or (member_role='pro' and product_row.instructor_price_multiplier=1
            and product_row.distributor_price_multiplier=1 and product_row.staff_price_multiplier=1)
        then professional_price else coalesce(nullif(professional_price, 0), list_price) end
        * public.resolve_product_price_multiplier(product_row, member_role, tier.professional_price_multiplier)
      );
    end if;


    if requested_item.value ? 'expected_unit_price' and
      (requested_item.value ->> 'expected_unit_price')::numeric is distinct from unit_price then
      raise exception '商品價格已更新，請重新整理並確認金額後再建立付款單。' using errcode='22023';
    end if;
    if unit_price is null or unit_price < 0 then
      raise exception 'Invalid authoritative price for product %', product_row.id;
    end if;

    subtotal_amount := subtotal_amount + unit_price * quantity;
    order_items := order_items || jsonb_build_array(jsonb_build_object(
      'id', product_row.id,
      'product_id', product_row.id,
      'publication_status', product_row.publication_status,
      'variant_id', requested_variant,
      'name', product_row.name_zh,
      'nameZh', product_row.name_zh,
      'name_en', product_row.name,
      'size', item_size,
      'image_storage_path', (
        select image.storage_path
        from public.product_images image
        where image.product_id = product_row.id
          and image.active = true
        order by image.is_primary desc, image.sort_order asc, image.id asc
        limit 1
      ),
      'img', product_row.image_url,
      'qty', quantity,
      'list_price', list_price,
      'professional_price', professional_price,
      'apply_tier_multiplier', product_row.apply_tier_multiplier,
      'member_role', member_role,
      'price', unit_price,
      'unit_price', unit_price,
      'line_total', unit_price * quantity,
      'stock_at_order', item_stock,
      'available_qty_at_order', least(quantity, item_stock),
      'backorder_qty_at_order', greatest(quantity - item_stock, 0),
      'is_custom_order', variant_row.is_custom_order,
      'fulfillment_type', case when item_stock >= quantity then 'in_stock' else 'preorder' end,
      'fulfillment', case when item_stock >= quantity then '現貨商品' else '含預購商品' end,
      'shipping_time', case when item_stock >= quantity then '出貨時間為 5 個工作天內，每週二出貨' else '出貨時間為 7-14 個工作天' end
    ));
  end loop;

  if normalized_fulfillment_method = 'onsite_pickup' and not all_custom_order_items then
    raise exception 'Onsite pickup is available only when every item is a custom-order variant'
      using errcode = '42501';
  end if;

  -- Batch 2 only evaluates the exact legacy automatic activity model. The
  -- additional predicates prevent future coupon-only or gift definitions from
  -- accidentally entering checkout before their dedicated engine is enabled.
  select
    candidate.id,
    candidate.name,
    candidate.discount,
    candidate.discount_rate,
    candidate.discount_amount,
    candidate.discount_order,
    candidate.promotion_subtotal,
    candidate.promotion_final_subtotal
  into
    selected_promotion_id,
    selected_promotion_name,
    discount_amount,
    selected_promotion_rate,
    selected_promotion_amount,
    selected_promotion_order,
    selected_promotion_subtotal,
    selected_promotion_final_subtotal
  from (
    select
      promotion.id,
      promotion.name,
      round(eligible.subtotal - priced.final_subtotal) as discount,
      promotion.discount_rate,
      promotion.discount_amount,
      promotion.discount_order,
      eligible.subtotal as promotion_subtotal,
      priced.final_subtotal as promotion_final_subtotal,
      promotion.created_at
    from public.promotions promotion
    cross join lateral (
      select coalesce(sum((item ->> 'line_total')::numeric), 0) as subtotal
      from jsonb_array_elements(order_items) item
      where (item ->> 'product_id')::integer = any(promotion.product_ids)
        and coalesce(item ->> 'publication_status', 'active') = 'active'
    ) eligible
    cross join lateral (
      select greatest(
        0,
        case promotion.discount_order
          when 'amount_then_rate' then
            (eligible.subtotal - promotion.discount_amount) * promotion.discount_rate
          else
            eligible.subtotal * promotion.discount_rate - promotion.discount_amount
        end
      ) as final_subtotal
    ) priced
    where promotion.active = true
      and promotion.benefit_type = 'legacy_discount'
      and promotion.activation_type = 'automatic'
      and promotion.archived_at is null
      and (promotion.start_at is null or promotion.start_at <= now())
      and (promotion.end_at is null or promotion.end_at > now())
      and promotion.discount_rate between 0 and 1
      and promotion.discount_amount >= 0
      and cardinality(promotion.product_ids) > 0
      and eligible.subtotal > 0
      and priced.final_subtotal < eligible.subtotal
  ) candidate
  order by candidate.discount desc, candidate.created_at asc, candidate.id asc
  limit 1;

  if not found then
    selected_promotion_id := null;
    selected_promotion_name := null;
    discount_amount := 0;
    selected_promotion_rate := null;
    selected_promotion_amount := null;
    selected_promotion_order := null;
    selected_promotion_subtotal := 0;
    selected_promotion_final_subtotal := 0;
  end if;

  discount_amount := least(greatest(coalesce(discount_amount, 0), 0), subtotal_amount);
  if member_role in ('pro', 'instructor', 'distributor')
    and subtotal_amount - discount_amount < 5000
  then
    if not exists (
      select 1
      from public.shipping_groups appendable_group
      where appendable_group.user_id = auth.uid()
        and appendable_group.status = 'open'
        and exists (
          select 1
          from public.orders grouped_order
          where grouped_order.shipping_group_id = appendable_group.id
            and grouped_order.status in (
              'paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered'
            )
        )
    ) then
      raise exception 'Professional member order minimum is TWD 5000' using errcode = '22023';
    end if;
  end if;

  if normalized_fulfillment_method = 'onsite_pickup' then
    shipping_amount := 0;
  elsif member_role in ('pro', 'instructor', 'distributor')
    and subtotal_amount - discount_amount >= 15000
  then
    shipping_amount := 0;
  else
    shipping_amount := public.calculate_order_shipping(order_items);
  end if;

  total_amount := subtotal_amount - discount_amount + shipping_amount;
  pricing_snapshot := jsonb_build_object(
    'version', 3,
    'engine', 'authoritative_quote_v1',
    'calculated_at', clock_timestamp(),
    'currency', 'TWD',
    'member_role', member_role,
    'fulfillment_method', normalized_fulfillment_method,
    'items', order_items,
    'subtotal', subtotal_amount,
    'promotion', case
      when selected_promotion_id is null then null
      else jsonb_build_object(
        'id', selected_promotion_id,
        'name', selected_promotion_name,
        'discount_rate', selected_promotion_rate,
        'discount_amount', selected_promotion_amount,
        'discount_order', selected_promotion_order,
        'eligible_subtotal', selected_promotion_subtotal,
        'final_subtotal', selected_promotion_final_subtotal,
        'discount', discount_amount
      )
    end,
    'discount', discount_amount,
    'final_subtotal', subtotal_amount - discount_amount,
    'shipping_rule', jsonb_build_object(
      'version', 2,
      'code', case
        when normalized_fulfillment_method = 'onsite_pickup' then 'onsite-pickup'
        when member_role in ('pro', 'instructor', 'distributor') then 'professional-threshold'
        else 'standard'
      end,
      'standard_fee', 120,
      'professional_minimum', 5000,
      'professional_free_shipping_threshold', 15000,
      'free_product_id', 9
    ),
    'shipping', shipping_amount,
    'total', total_amount
  );

  return jsonb_build_object(
    'member_role', member_role,
    'items', order_items,
    'subtotal', subtotal_amount,
    'discount', discount_amount,
    'shipping', shipping_amount,
    'total', total_amount,
    'fulfillment_method', normalized_fulfillment_method,
    'promotion_id', selected_promotion_id,
    'promotion_name', selected_promotion_name,
    'pricing_snapshot', pricing_snapshot
  );
end;
$function$;
revoke all on function public.quote_order_pricing_internal_20260916(jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.quote_order_pricing_internal_20260916(jsonb,text) to postgres,service_role;
-- New endpoints are disabled on recovery, without deleting schema/history.
revoke all on function public.get_my_student_product_prices(), public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
