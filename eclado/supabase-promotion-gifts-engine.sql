-- ECLADO promotions / coupons batch 4
-- Gift qualification, transactional unpaid-order reservation, payment
-- consumption and cancellation release. Gift inventory is never backordered.

begin;

-- A product variant may keep a gift-only inventory pool in addition to its
-- normal sale inventory. Both ordinary products and gift_only products use
-- this same path; the product row remains the single source for content.
alter table public.product_variants
  add column if not exists gift_enabled boolean not null default false,
  add column if not exists gift_stock integer not null default 0,
  add column if not exists gift_min_stock integer not null default 0;

-- A dynamic storefront-wide scope includes ordinary and event-only products,
-- while still excluding gift-only, draft, and archived products.
alter table public.promotion_scopes
  drop constraint if exists promotion_scopes_target_type_check;
alter table public.promotion_scopes
  drop constraint if exists promotion_scopes_target_check;
alter table public.promotion_scopes
  add constraint promotion_scopes_target_type_check check (
    target_type in ('all_regular', 'all_sellable', 'product', 'variant', 'category', 'series')
  );
alter table public.promotion_scopes
  add constraint promotion_scopes_target_check check (
    (target_type in ('all_regular', 'all_sellable') and product_id is null and product_variant_id is null and target_value is null)
    or (target_type = 'product' and product_id is not null and product_variant_id is null and target_value is null)
    or (target_type = 'variant' and product_id is null and product_variant_id is not null and target_value is null)
    or (target_type in ('category', 'series') and product_id is null and product_variant_id is null and nullif(btrim(target_value), '') is not null)
  );

create or replace function public.promotion_item_matches_scope(
  p_promotion_id uuid,
  p_item jsonb,
  p_scope_role text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with item_data as (
    select
      nullif(p_item ->> 'product_id', '')::integer as product_id,
      nullif(p_item ->> 'variant_id', '')::bigint as variant_id
  ), product_data as (
    select product.*
    from public.products product
    join item_data item on item.product_id = product.id
  ), scopes as (
    select scope.*
    from public.promotion_scopes scope
    where scope.promotion_id = p_promotion_id
      and scope.scope_role = p_scope_role
  ), matched as (
    select scope.mode
    from scopes scope
    cross join item_data item
    cross join product_data product
    where case scope.target_type
      when 'all_regular' then product.publication_status = 'active'
      when 'all_sellable' then product.publication_status in ('active', 'event_only')
      when 'product' then scope.product_id = item.product_id
      when 'variant' then scope.product_variant_id = item.variant_id
      when 'category' then lower(btrim(scope.target_value)) = lower(btrim(coalesce(product.category, '')))
      when 'series' then lower(btrim(scope.target_value)) = lower(btrim(coalesce(product.series, '')))
      else false
    end
  )
  select exists (select 1 from matched where mode = 'include')
    and not exists (select 1 from matched where mode = 'exclude');
$$;
revoke all on function public.promotion_item_matches_scope(uuid, jsonb, text) from public;

create or replace function public.prepare_product_variant()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.sku := btrim(new.sku);
  new.size := btrim(new.size);
  if new.gift_enabled is not true then
    new.gift_stock := 0;
    new.gift_min_stock := 0;
  end if;
  new.updated_at := now();
  if new.is_default is true then
    update public.product_variants
    set is_default=false
    where product_id=new.product_id and id is distinct from new.id and is_default=true;
  end if;
  return new;
end;
$$;

-- Move existing gift-only variants onto the single gift-inventory model.
update public.product_variants variant
set gift_enabled = variant.active,
    gift_stock = case when not variant.active then 0 when variant.gift_enabled then variant.gift_stock else variant.stock end,
    gift_min_stock = case when not variant.active then 0 when variant.gift_enabled then variant.gift_min_stock else coalesce(product.min_stock, 0) end,
    stock = 0,
    updated_at = now()
from public.products product
where product.id = variant.product_id
  and product.publication_status = 'gift_only';

alter table public.product_variants
  drop constraint if exists product_variants_gift_inventory_check;
alter table public.product_variants
  add constraint product_variants_gift_inventory_check check (
    (
      gift_enabled = true
      and active = true
      and gift_stock >= 0
      and gift_min_stock >= 0
    )
    or (
      gift_enabled = false
      and gift_stock = 0
      and gift_min_stock = 0
    )
  );

create or replace function public.protect_reserved_gift_inventory()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  reserved_quantity integer;
begin
  select coalesce(sum(reservation.quantity), 0)::integer
  into reserved_quantity
  from public.promotion_gift_reservations reservation
  where reservation.product_variant_id = new.id
    and reservation.status = 'reserved'
    and reservation.expires_at > now();

  if reserved_quantity > 0 and (
    new.gift_enabled is false or new.active is false or new.gift_stock < reserved_quantity
  ) then
    raise exception 'Gift inventory has % reserved units and cannot be reduced or disabled', reserved_quantity
      using errcode='55000';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_reserved_gift_inventory() from public;
drop trigger if exists trg_protect_reserved_gift_inventory on public.product_variants;
create trigger trg_protect_reserved_gift_inventory
  before update of gift_enabled, gift_stock, active on public.product_variants
  for each row execute function public.protect_reserved_gift_inventory();

-- Gift inventory is operational data. Public catalog RPCs must never expose
-- its enable flag, exact stock, or alert threshold.
create or replace function public.get_storefront_catalog()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_role text := 'consumer';
  can_view_professional_price boolean := false;
  payload jsonb;
begin
  if auth.uid() is not null then
    select coalesce(profile.role, 'consumer') into viewer_role
    from public.profiles profile where profile.id = auth.uid();
  end if;
  can_view_professional_price := viewer_role in ('pro', 'instructor', 'distributor');
  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(
        (to_jsonb(product) - array['min_stock','pro_price','stock','variants','created_at','updated_at'])
        || jsonb_build_object(
          'pro_price', case when can_view_professional_price then product.pro_price else null end,
          'stock', case when product.stock > 0 then 1 else 0 end
        ) order by product.id
      ) from public.products product
      where product.publication_status='active' and product.active=true
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(
        (to_jsonb(variant) - array[
          'sku','pro_price','stock','gift_enabled','gift_stock','gift_min_stock','created_at','updated_at'
        ]) || jsonb_build_object(
          'pro_price', case when can_view_professional_price then variant.pro_price else null end,
          'stock', case when variant.stock > 0 then 1 else 0 end
        ) order by variant.product_id,variant.sort_order,variant.id
      ) from public.product_variants variant
      join public.products product on product.id=variant.product_id
      where variant.active=true and product.publication_status='active' and product.active=true
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',image.id,'product_id',image.product_id,'storage_path',image.storage_path,
        'alt_text',image.alt_text,'sort_order',image.sort_order,'is_primary',image.is_primary,'active',image.active
      ) order by image.product_id,image.sort_order,image.id)
      from public.product_images image
      join public.products product on product.id=image.product_id
      where image.active=true and product.publication_status='active' and product.active=true
    ), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$$;
revoke all on function public.get_storefront_catalog() from public;
grant execute on function public.get_storefront_catalog() to anon, authenticated;

create or replace function public.get_event_catalog()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_role text := 'consumer';
  can_view_professional_price boolean := false;
  payload jsonb;
begin
  if auth.uid() is not null then
    select coalesce(profile.role, 'consumer') into viewer_role
    from public.profiles profile where profile.id = auth.uid();
  end if;
  can_view_professional_price := viewer_role in ('pro', 'instructor', 'distributor');
  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(
        (to_jsonb(product) - array['min_stock','pro_price','stock','variants','created_at','updated_at'])
        || jsonb_build_object(
          'pro_price', case when can_view_professional_price then product.pro_price else null end,
          'stock', case when product.stock > 0 then 1 else 0 end
        ) order by product.id
      ) from public.products product where product.publication_status='event_only'
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(
        (to_jsonb(variant) - array[
          'sku','pro_price','stock','gift_enabled','gift_stock','gift_min_stock','created_at','updated_at'
        ]) || jsonb_build_object(
          'pro_price', case when can_view_professional_price then variant.pro_price else null end,
          'stock', case when variant.stock > 0 then 1 else 0 end
        ) order by variant.product_id,variant.sort_order,variant.id
      ) from public.product_variants variant
      join public.products product on product.id=variant.product_id
      where variant.active=true and product.publication_status='event_only'
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',image.id,'product_id',image.product_id,'storage_path',image.storage_path,
        'alt_text',image.alt_text,'sort_order',image.sort_order,'is_primary',image.is_primary,'active',image.active
      ) order by image.product_id,image.sort_order,image.id)
      from public.product_images image
      join public.products product on product.id=image.product_id
      where image.active=true and product.publication_status='event_only'
    ), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$$;
revoke all on function public.get_event_catalog() from public;
grant execute on function public.get_event_catalog() to anon, authenticated;

-- Preserve the batch-3 engines as implementation helpers. The public
-- signatures below remain stable for deployed browsers.
do $$
begin
  if to_regprocedure('public.quote_order_pricing_discount_v2(jsonb,text,text,text)') is null then
    alter function public.quote_order_pricing(jsonb, text, text, text)
      rename to quote_order_pricing_discount_v2;
  end if;
  if to_regprocedure('public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)') is null then
    alter function public.create_order_with_pricing(jsonb, text, text, text, text, text, text, text, text)
      rename to create_order_with_pricing_discount_v2;
  end if;
end;
$$;

create or replace function public.quote_order_pricing(
  p_items jsonb,
  p_fulfillment_method text,
  p_coupon_code text,
  p_guest_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  result jsonb;
  merchandise_items jsonb;
  gift_items jsonb := '[]'::jsonb;
  gift_adjustments jsonb := '[]'::jsonb;
  campaign_id uuid;
  stacking_policy text;
  candidate record;
  qualification_value numeric;
  repeat_count integer;
  awarded_quantity integer;
  reserved_quantity integer;
  available_quantity integer;
  gift_product_id integer;
  gift_item_sku text;
  gift_size text;
  gift_name_zh text;
  gift_name_en text;
  gift_image_path text;
  normalized_code text := upper(btrim(coalesce(p_coupon_code, '')));
begin
  result := public.quote_order_pricing_discount_v2(
    p_items, p_fulfillment_method, p_coupon_code, p_guest_email
  );
  merchandise_items := result -> 'items';
  campaign_id := nullif(result ->> 'coupon_campaign_id', '')::uuid;
  stacking_policy := coalesce(result #>> '{pricing_snapshot,coupon,stacking_policy}', '');

  for candidate in
    select promotion.*, link.coupon_campaign_id, coalesce(link.sort_order, 0) as bundle_sort_order
    from public.promotions promotion
    left join public.coupon_promotions link
      on link.promotion_id = promotion.id and link.coupon_campaign_id = campaign_id
    where promotion.active = true
      and promotion.archived_at is null
      and promotion.benefit_type in ('amount_gift', 'quantity_gift')
      and (promotion.start_at is null or promotion.start_at <= now())
      and (promotion.end_at is null or promotion.end_at > now())
      and (
        (promotion.activation_type = 'coupon_only' and link.coupon_campaign_id = campaign_id)
        or (
          promotion.activation_type = 'automatic'
          and (campaign_id is null or stacking_policy in ('allow_auto_gifts', 'allow_all'))
        )
      )
    order by
      case when promotion.activation_type = 'coupon_only' then 0 else 1 end,
      coalesce(link.sort_order, promotion.priority), promotion.created_at, promotion.id
  loop
    if candidate.benefit_type = 'amount_gift' then
      select coalesce(sum((item ->> 'line_total')::numeric), 0)
      into qualification_value
      from jsonb_array_elements(merchandise_items) item
      where public.promotion_item_matches_scope(candidate.id, item, 'qualification');
    else
      select coalesce(sum((item ->> 'qty')::numeric), 0)
      into qualification_value
      from jsonb_array_elements(merchandise_items) item
      where public.promotion_item_matches_scope(candidate.id, item, 'qualification');
    end if;

    if qualification_value < candidate.threshold_value then
      continue;
    end if;
    repeat_count := case when candidate.repeat_mode = 'repeat'
      then floor(qualification_value / candidate.threshold_value)::integer else 1 end;
    awarded_quantity := candidate.gift_quantity * greatest(repeat_count, 1);

    select variant.product_id, variant.sku, variant.size, variant.gift_stock,
      product.name_zh, product.name_en,
      coalesce(image.storage_path, product.image_storage_path)
    into gift_product_id, gift_item_sku, gift_size, available_quantity,
      gift_name_zh, gift_name_en, gift_image_path
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    left join lateral (
      select product_image.storage_path
      from public.product_images product_image
      where product_image.product_id = product.id and product_image.active = true
      order by product_image.is_primary desc, product_image.sort_order, product_image.id
      limit 1
    ) image on true
    where variant.id = candidate.gift_variant_id
      and variant.active = true
      and variant.gift_enabled = true
      and product.publication_status in ('active', 'event_only', 'gift_only');

    if not found then
      if candidate.activation_type = 'coupon_only' then
        raise exception '優惠券指定的贈品庫存目前不可使用' using errcode = '22023';
      end if;
      continue;
    end if;

    select coalesce(sum(reservation.quantity), 0)::integer
    into reserved_quantity
    from public.promotion_gift_reservations reservation
    where reservation.product_variant_id = candidate.gift_variant_id
      and reservation.status = 'reserved'
      and reservation.expires_at > now();
    select reserved_quantity + coalesce(sum((gift ->> 'qty')::integer), 0)::integer
    into reserved_quantity
    from jsonb_array_elements(gift_items) gift
    where (gift ->> 'variant_id')::bigint = candidate.gift_variant_id;
    available_quantity := greatest(coalesce(available_quantity, 0) - reserved_quantity, 0);

    if available_quantity < awarded_quantity then
      if candidate.activation_type = 'coupon_only' then
        raise exception '優惠券贈品已兌換完畢' using errcode = '22023';
      end if;
      continue;
    end if;

    gift_items := gift_items || jsonb_build_array(jsonb_build_object(
      'product_id', gift_product_id,
      'variant_id', candidate.gift_variant_id,
      'sku', gift_item_sku,
      'name', gift_name_zh,
      'nameZh', gift_name_zh,
      'name_en', gift_name_en,
      'size', gift_size,
      'qty', awarded_quantity,
      'unit_price', 0,
      'price', 0,
      'line_total', 0,
      'line_type', 'gift',
      'is_gift', true,
      'promotion_id', candidate.id,
      'coupon_campaign_id', candidate.coupon_campaign_id,
      'image_storage_path', gift_image_path,
      'stock_at_order', awarded_quantity,
      'fulfillment_type', 'in_stock',
      'fulfillment_label', '贈品已保留',
      'shipping_label', '與訂單一併出貨'
    ));
    gift_adjustments := gift_adjustments || jsonb_build_array(jsonb_build_object(
      'promotion_id', candidate.id,
      'coupon_campaign_id', candidate.coupon_campaign_id,
      'adjustment_type', candidate.benefit_type,
      'name', candidate.name,
      'amount', 0,
      'gift_product_id', gift_product_id,
      'gift_variant_id', candidate.gift_variant_id,
      'gift_quantity', awarded_quantity,
      'sort_order', 100 + candidate.bundle_sort_order,
      'qualification', jsonb_build_object(
        'basis', case when candidate.benefit_type = 'amount_gift' then 'amount' else 'quantity' end,
        'value', qualification_value,
        'threshold', candidate.threshold_value,
        'repeat_mode', candidate.repeat_mode,
        'repeat_count', repeat_count
      )
    ));
  end loop;

  if campaign_id is not null
    and not exists (
      select 1 from jsonb_array_elements(
        coalesce(result -> 'adjustments', '[]'::jsonb) || gift_adjustments
      ) adjustment
      where nullif(adjustment ->> 'coupon_campaign_id', '')::uuid = campaign_id
    )
  then
    raise exception '此優惠碼不適用目前購物車內容' using errcode = '22023';
  end if;

  result := jsonb_set(result, '{items}', merchandise_items || gift_items, true);
  result := jsonb_set(result, '{adjustments}', coalesce(result -> 'adjustments', '[]'::jsonb) || gift_adjustments, true);
  result := jsonb_set(result, '{gifts}', gift_items, true);
  result := jsonb_set(result, '{pricing_snapshot,version}', '5'::jsonb, true);
  result := jsonb_set(result, '{pricing_snapshot,engine}', '"authoritative_quote_v3_gifts"'::jsonb, true);
  result := jsonb_set(result, '{pricing_snapshot,items}', merchandise_items || gift_items, true);
  result := jsonb_set(result, '{pricing_snapshot,adjustments}', coalesce(result -> 'adjustments', '[]'::jsonb), true);
  result := jsonb_set(result, '{pricing_snapshot,gifts}', gift_items, true);
  return result;
end;
$$;

revoke all on function public.quote_order_pricing(jsonb, text, text, text) from public;
grant execute on function public.quote_order_pricing(jsonb, text, text, text) to anon, authenticated;

create or replace function public.create_order_with_pricing(
  p_items jsonb, p_member text, p_address text, p_phone text, p_email text,
  p_note text, p_payment_method text, p_fulfillment_method text, p_coupon_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  result jsonb;
  order_id text;
  payment_expiry timestamptz;
  gift jsonb;
  adjustment jsonb;
  stock_quantity integer;
  reserved_quantity integer;
begin
  result := public.create_order_with_pricing_discount_v2(
    p_items, p_member, p_address, p_phone, p_email, p_note,
    p_payment_method, p_fulfillment_method, p_coupon_code
  );
  order_id := result ->> 'order_id';
  select payment_due_at into payment_expiry from public.orders where id = order_id;

  -- Deterministic locks make the quote-to-reservation recheck authoritative.
  perform 1
  from public.product_variants variant
  where variant.id in (
    select distinct (item ->> 'variant_id')::bigint
    from jsonb_array_elements(coalesce(result -> 'gifts', '[]'::jsonb)) item
  )
  order by variant.id for update;

  for gift in select value from jsonb_array_elements(coalesce(result -> 'gifts', '[]'::jsonb))
  loop
    select variant.gift_stock into stock_quantity
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where variant.id = (gift ->> 'variant_id')::bigint
      and variant.active = true
      and variant.gift_enabled = true
      and product.publication_status in ('active', 'event_only', 'gift_only')
    for update of variant;
    if not found then raise exception '贈品規格已停用' using errcode = '22023'; end if;

    select coalesce(sum(reservation.quantity), 0)::integer into reserved_quantity
    from public.promotion_gift_reservations reservation
    where reservation.product_variant_id = (gift ->> 'variant_id')::bigint
      and reservation.status = 'reserved' and reservation.expires_at > now();
    if stock_quantity - reserved_quantity < (gift ->> 'qty')::integer then
      raise exception '贈品已兌換完畢，請重新確認訂單' using errcode = '40001';
    end if;

    insert into public.promotion_gift_reservations (
      order_id, promotion_id, coupon_campaign_id, product_variant_id,
      quantity, status, expires_at
    ) values (
      order_id, (gift ->> 'promotion_id')::uuid,
      nullif(gift ->> 'coupon_campaign_id', '')::uuid,
      (gift ->> 'variant_id')::bigint, (gift ->> 'qty')::integer,
      'reserved', payment_expiry
    );
  end loop;

  for adjustment in
    select value from jsonb_array_elements(coalesce(result -> 'adjustments', '[]'::jsonb))
    where value ->> 'adjustment_type' in ('amount_gift', 'quantity_gift')
  loop
    insert into public.order_adjustments (
      order_id, promotion_id, coupon_campaign_id, adjustment_type,
      name_snapshot, qualification_snapshot, amount,
      gift_product_id, gift_variant_id, gift_quantity, sort_order, metadata
    ) values (
      order_id, (adjustment ->> 'promotion_id')::uuid,
      nullif(adjustment ->> 'coupon_campaign_id', '')::uuid,
      adjustment ->> 'adjustment_type', adjustment ->> 'name',
      coalesce(adjustment -> 'qualification', '{}'::jsonb), 0,
      (adjustment ->> 'gift_product_id')::integer,
      (adjustment ->> 'gift_variant_id')::bigint,
      (adjustment ->> 'gift_quantity')::integer,
      coalesce((adjustment ->> 'sort_order')::integer, 100),
      jsonb_build_object('pricing_engine_version', 5)
    );
  end loop;
  return result;
end;
$$;

revoke all on function public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text) from public;
grant execute on function public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text) to anon, authenticated;

-- Gift reservation is converted into an allocation at payment. Merchandise
-- continues to use the existing FIFO/backorder path unchanged.
create or replace function public.allocate_inventory_for_paid_order(target_order_id text, order_items jsonb)
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

-- Cancellation/return restores each item to the same inventory pool that was
-- consumed at payment time.
create or replace function public.release_inventory_for_order(target_order_id text)
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

create or replace function public.sync_gift_reservation_from_order_status()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status in ('cancelled','returned') then
    update public.promotion_gift_reservations
    set status='released', released_at=coalesce(released_at,now()), release_reason='order_'||new.status
    where order_id=new.id and status in ('reserved','consumed');
  end if;
  return new;
end;
$$;
revoke all on function public.sync_gift_reservation_from_order_status() from public;
drop trigger if exists trg_sync_gift_reservation_from_order_status on public.orders;
create trigger trg_sync_gift_reservation_from_order_status
  after update of status on public.orders for each row
  when (old.status is distinct from new.status)
  execute function public.sync_gift_reservation_from_order_status();

-- The same transactional editor now supports all four atomic benefit types.
create or replace function public.save_discount_promotion(p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare
  target_id uuid := nullif(p_payload->>'id','')::uuid;
  benefit text := p_payload->>'benefit_type'; activation text := p_payload->>'activation_type';
  scope_type text := coalesce(p_payload->>'scope_type','all_regular'); target_product_id integer;
  gift_variant bigint := nullif(p_payload->>'gift_variant_id','')::bigint;
  threshold_kind text;
begin
  threshold_kind := case
    when benefit = 'quantity_gift' then 'quantity'
    when benefit = 'amount_gift' then 'amount'
    else coalesce(nullif(p_payload->>'threshold_type',''), 'amount')
  end;
  if not public.has_backoffice_permission('promotions.manage') then raise exception 'Promotion management access required' using errcode='42501'; end if;
  if nullif(btrim(p_payload->>'name'),'') is null then raise exception 'Promotion name is required' using errcode='22023'; end if;
  if benefit not in ('percentage_discount','fixed_discount','amount_gift','quantity_gift')
    or activation not in ('automatic','coupon_only') or scope_type not in ('all_regular','all_sellable','products')
    then raise exception 'Invalid promotion configuration' using errcode='22023'; end if;
  if threshold_kind not in ('amount','quantity') then raise exception 'Invalid promotion threshold type' using errcode='22023'; end if;
  if threshold_kind = 'quantity' and nullif(p_payload->>'threshold_value','') is not null
    and (p_payload->>'threshold_value')::numeric <> trunc((p_payload->>'threshold_value')::numeric)
    then raise exception 'Quantity threshold must be a whole number' using errcode='22023'; end if;
  if benefit in ('amount_gift','quantity_gift') then
    if coalesce((p_payload->>'threshold_value')::numeric,0)<=0 or coalesce((p_payload->>'gift_quantity')::integer,0)<=0 then raise exception 'Gift threshold and quantity are required' using errcode='22023'; end if;
    if not exists(select 1 from public.product_variants variant join public.products product on product.id=variant.product_id where variant.id=gift_variant and variant.active=true and variant.gift_enabled=true and product.publication_status in ('active','event_only','gift_only')) then raise exception 'Gift must use enabled gift inventory' using errcode='22023'; end if;
  end if;
  if benefit='percentage_discount' and coalesce((p_payload->>'discount_rate')::numeric,1) not between 0 and 1 then raise exception 'Discount rate must be between 0 and 1' using errcode='22023'; end if;
  if benefit='fixed_discount' and coalesce((p_payload->>'discount_amount')::numeric,0)<=0 then raise exception 'Discount amount must be greater than zero' using errcode='22023'; end if;
  if scope_type='products' and jsonb_array_length(coalesce(p_payload->'product_ids','[]'::jsonb))=0 then raise exception 'Choose at least one product' using errcode='22023'; end if;

  if target_id is null then
    insert into public.promotions(name,description,product_ids,discount_rate,discount_amount,discount_order,start_at,end_at,active,benefit_type,activation_type,threshold_value,threshold_type,threshold_basis,gift_variant_id,gift_quantity,repeat_mode,priority)
    values(btrim(p_payload->>'name'),nullif(btrim(p_payload->>'description'),''),array(select jsonb_array_elements_text(coalesce(p_payload->'product_ids','[]'::jsonb))::integer),case when benefit='percentage_discount' then (p_payload->>'discount_rate')::numeric else 1 end,case when benefit='fixed_discount' then (p_payload->>'discount_amount')::numeric else 0 end,'rate_then_amount',nullif(p_payload->>'start_at','')::timestamptz,nullif(p_payload->>'end_at','')::timestamptz,coalesce((p_payload->>'active')::boolean,true),benefit,activation,nullif(p_payload->>'threshold_value','')::numeric,threshold_kind,case when benefit in ('percentage_discount','fixed_discount') and threshold_kind='amount' and nullif(p_payload->>'threshold_value','') is not null then coalesce(nullif(p_payload->>'threshold_basis',''),'before_bundle_discount') end,case when benefit in ('amount_gift','quantity_gift') then gift_variant end,case when benefit in ('amount_gift','quantity_gift') then (p_payload->>'gift_quantity')::integer end,coalesce(nullif(p_payload->>'repeat_mode',''),'once'),coalesce((p_payload->>'priority')::integer,100)) returning id into target_id;
  else
    update public.promotions set name=btrim(p_payload->>'name'),description=nullif(btrim(p_payload->>'description'),''),product_ids=array(select jsonb_array_elements_text(coalesce(p_payload->'product_ids','[]'::jsonb))::integer),discount_rate=case when benefit='percentage_discount' then (p_payload->>'discount_rate')::numeric else 1 end,discount_amount=case when benefit='fixed_discount' then (p_payload->>'discount_amount')::numeric else 0 end,start_at=nullif(p_payload->>'start_at','')::timestamptz,end_at=nullif(p_payload->>'end_at','')::timestamptz,active=coalesce((p_payload->>'active')::boolean,true),benefit_type=benefit,activation_type=activation,threshold_value=nullif(p_payload->>'threshold_value','')::numeric,threshold_type=threshold_kind,threshold_basis=case when benefit in ('percentage_discount','fixed_discount') and threshold_kind='amount' and nullif(p_payload->>'threshold_value','') is not null then coalesce(nullif(p_payload->>'threshold_basis',''),'before_bundle_discount') end,gift_variant_id=case when benefit in ('amount_gift','quantity_gift') then gift_variant end,gift_quantity=case when benefit in ('amount_gift','quantity_gift') then (p_payload->>'gift_quantity')::integer end,repeat_mode=coalesce(nullif(p_payload->>'repeat_mode',''),'once'),priority=coalesce((p_payload->>'priority')::integer,100)
    where id=target_id and archived_at is null;
    if not found then raise exception 'Promotion not found' using errcode='P0002'; end if;
    delete from public.promotion_scopes where promotion_id=target_id;
  end if;
  if scope_type in ('all_regular','all_sellable') then
    insert into public.promotion_scopes(promotion_id,scope_role,target_type) values(target_id,'qualification',scope_type),(target_id,'benefit',scope_type);
  else
    for target_product_id in select jsonb_array_elements_text(p_payload->'product_ids')::integer loop
      insert into public.promotion_scopes(promotion_id,scope_role,target_type,product_id) values(target_id,'qualification','product',target_product_id),(target_id,'benefit','product',target_product_id);
    end loop;
  end if;
  return target_id;
end;
$$;
revoke all on function public.save_discount_promotion(jsonb) from public;
grant execute on function public.save_discount_promotion(jsonb) to authenticated;

comment on function public.quote_order_pricing(jsonb,text,text,text) is
  'Authoritative pricing plus automatic/coupon gift evaluation. Read-only: availability is rechecked and reserved by order creation.';

commit;
