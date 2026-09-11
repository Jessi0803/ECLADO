-- ECLADO promotions and coupons — batch 2 authoritative quote engine
--
-- Run after supabase-promotions-coupons-foundation.sql.
-- This batch deliberately supports legacy automatic discounts only. Coupon,
-- gift and new atomic benefit evaluation remains disabled until later batches.

begin;

-- Some production environments predate the product-level tier override even
-- though the current catalog and checkout code already depend on it. Adding
-- the default is backward-compatible; the existing Gold Patch exception is
-- restored to the rule already documented in supabase-product-tier-multiplier.sql.
alter table public.products
  add column if not exists apply_tier_multiplier boolean not null default true;

update public.products
set apply_tier_multiplier = false,
    updated_at = now()
where (name_zh in ('金箔片', '金箔貼片') or slug = 'gold-patch')
  and apply_tier_multiplier is distinct from false;

comment on column public.products.apply_tier_multiplier is
  'When false, pro/instructor/distributor all pay the configured professional price without role multipliers.';

create or replace function public.quote_order_pricing(
  p_items jsonb,
  p_fulfillment_method text default 'delivery'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
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
    elsif product_row.apply_tier_multiplier is false then
      unit_price := professional_price;
    else
      unit_price := round(
        coalesce(nullif(professional_price, 0), list_price)
        * tier.professional_price_multiplier
      );
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
    raise exception 'Professional member order minimum is TWD 5000'
      using errcode = '22023';
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
$$;

revoke all on function public.quote_order_pricing(jsonb, text) from public;
grant execute on function public.quote_order_pricing(jsonb, text) to anon, authenticated;

comment on function public.quote_order_pricing(jsonb, text) is
  'Read-only authoritative cart quote. Derives the caller membership from auth.uid and never accepts browser prices, discounts, roles, gifts or coupon results.';

create or replace function public.create_order_with_pricing(
  p_items jsonb,
  p_member text,
  p_address text,
  p_phone text,
  p_email text,
  p_note text default '',
  p_payment_method text default 'atm',
  p_fulfillment_method text default 'delivery'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_fulfillment_method text := coalesce(nullif(trim(p_fulfillment_method), ''), 'delivery');
  quote_result jsonb;
  payment_token text := encode(gen_random_bytes(32), 'hex');
  order_id text;
  order_status text;
begin
  if normalized_fulfillment_method = 'delivery' and nullif(trim(p_address), '') is null then
    raise exception 'Delivery address is required' using errcode = '22023';
  end if;

  quote_result := public.quote_order_pricing(p_items, normalized_fulfillment_method);
  order_status := case when p_payment_method = 'atm' then 'awaiting_confirm' else 'unpaid' end;
  order_id := 'ECL-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-')
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders (
    id, member, type, items, total, subtotal, discount, status, date,
    address, phone, email, note, user_id, promotion_id, promotion_name,
    pricing_snapshot, fulfillment_method
  )
  values (
    order_id,
    coalesce(nullif(trim(p_member), ''), '訪客'),
    quote_result ->> 'member_role',
    quote_result -> 'items',
    (quote_result ->> 'total')::numeric,
    (quote_result ->> 'subtotal')::numeric,
    (quote_result ->> 'discount')::numeric,
    order_status,
    current_date::text,
    coalesce(p_address, ''),
    coalesce(p_phone, ''),
    coalesce(p_email, ''),
    coalesce(p_note, ''),
    current_user_id,
    nullif(quote_result ->> 'promotion_id', '')::uuid,
    quote_result ->> 'promotion_name',
    quote_result -> 'pricing_snapshot',
    quote_result ->> 'fulfillment_method'
  );

  insert into public.order_payment_authorizations (order_id, token_hash, provider_order_no, attempt_no)
  values (order_id, encode(digest(payment_token, 'sha256'), 'hex'), order_id, 1);

  return quote_result || jsonb_build_object(
    'order_id', order_id,
    'status', order_status,
    'payment_token', payment_token
  );
end;
$$;

revoke all on function public.create_order_with_pricing(
  jsonb, text, text, text, text, text, text, text
) from public;

grant execute on function public.create_order_with_pricing(
  jsonb, text, text, text, text, text, text, text
) to anon, authenticated;

comment on function public.create_order_with_pricing(
  jsonb, text, text, text, text, text, text, text
) is 'Creates an order from quote_order_pricing so preview and persisted totals share one authoritative pricing engine.';

commit;
