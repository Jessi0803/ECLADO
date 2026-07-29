-- ECLADO authoritative pricing — phases 1, 2B and 2C
-- Run in Supabase SQL Editor after supabase-full-setup.sql and supabase-products.sql.
--
-- The browser may preview prices, but this RPC is the authority for:
-- - member role
-- - product / variant unit price
-- - professional-only eligibility
-- - shipping and order total
-- - immutable order item price snapshots
--
-- At most one live promotion is applied. If several promotions match the cart,
-- the database chooses the promotion that produces the largest discount.

create extension if not exists pgcrypto;

alter table public.orders
  add column if not exists pricing_snapshot jsonb not null default '{}'::jsonb;

create table if not exists public.order_payment_authorizations (
  order_id text primary key references public.orders(id) on delete cascade,
  token_hash text not null,
  claimed_at timestamptz,
  gateway_created_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.order_payment_authorizations enable row level security;

create or replace function public.calculate_order_shipping(p_items jsonb)
returns numeric
language sql
immutable
strict
set search_path = public
as $$
  select case
    when jsonb_array_length(p_items) > 0
      and not exists (
        select 1
        from jsonb_array_elements(p_items) item
        where (item ->> 'product_id')::integer <> 9
      )
    then 0::numeric
    else 120::numeric
  end;
$$;

revoke all on function public.calculate_order_shipping(jsonb) from public;

create table if not exists public.membership_tiers (
  role text primary key,
  label text not null,
  professional_price_multiplier numeric,
  can_buy_pro_products boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  check (professional_price_multiplier is null or professional_price_multiplier > 0)
);

insert into public.membership_tiers
  (role, label, professional_price_multiplier, can_buy_pro_products, active)
values
  ('consumer', '一般會員', null, false, true),
  ('pending', '審核中', null, false, true),
  ('pro', '美容師', 1.00, true, true),
  ('instructor', '師資', 0.70, true, true),
  ('distributor', '經銷商', 0.65, true, true)
on conflict (role) do update set
  label = excluded.label,
  professional_price_multiplier = excluded.professional_price_multiplier,
  can_buy_pro_products = excluded.can_buy_pro_products,
  active = excluded.active,
  updated_at = now();

alter table public.membership_tiers enable row level security;

drop policy if exists "membership_tiers_select_all" on public.membership_tiers;
create policy "membership_tiers_select_all"
  on public.membership_tiers for select
  using (true);

create or replace function public.create_order_with_pricing(
  p_items jsonb,
  p_member text,
  p_address text,
  p_phone text,
  p_email text,
  p_note text default '',
  p_payment_method text default 'atm'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
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
  payment_token text := encode(gen_random_bytes(32), 'hex');
  order_id text;
  order_status text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many cart items' using errcode = '22023';
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
        and publication_status = 'active';

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

    if tier.professional_price_multiplier is null then
      unit_price := list_price;
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
      'variant_id', requested_variant,
      'name', product_row.name_zh,
      'nameZh', product_row.name_zh,
      'name_en', product_row.name,
      'size', item_size,
      'img', product_row.image_url,
      'qty', quantity,
      'list_price', list_price,
      'professional_price', professional_price,
      'member_role', member_role,
      'price', unit_price,
      'unit_price', unit_price,
      'line_total', unit_price * quantity,
      'stock_at_order', item_stock,
      'fulfillment_type', case when item_stock > 0 then 'in_stock' else 'preorder' end,
      'fulfillment', case when item_stock > 0 then '現貨商品' else '預購商品' end,
      'shipping_time', case when item_stock > 0 then '出貨時間為 5 個工作天內，每週二出貨' else '出貨時間為 7-14 個工作天' end
    ));
  end loop;

  -- Choose one valid promotion that produces the largest discount. Only line
  -- totals from products listed by that promotion participate in its formula.
  -- Browser-provided promotion IDs, rates and amounts are never accepted.
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

  if member_role in ('pro', 'instructor', 'distributor')
    and subtotal_amount - discount_amount >= 10000
  then
    shipping_amount := 0;
  else
    shipping_amount := public.calculate_order_shipping(order_items);
  end if;

  total_amount := subtotal_amount - discount_amount + shipping_amount;
  pricing_snapshot := jsonb_build_object(
    'version', 2,
    'calculated_at', clock_timestamp(),
    'currency', 'TWD',
    'member_role', member_role,
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
        when member_role in ('pro', 'instructor', 'distributor') then 'professional-threshold'
        else 'standard'
      end,
      'standard_fee', 120,
      'professional_minimum', 5000,
      'professional_free_shipping_threshold', 10000,
      'free_product_id', 9
    ),
    'shipping', shipping_amount,
    'total', total_amount
  );
  order_status := case when p_payment_method = 'atm' then 'awaiting_confirm' else 'unpaid' end;
  order_id := 'ECL-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-')
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders (
    id, member, type, items, total, subtotal, discount, status, date,
    address, phone, email, note, user_id, promotion_id, promotion_name,
    pricing_snapshot
  )
  values (
    order_id,
    coalesce(nullif(trim(p_member), ''), '訪客'),
    member_role,
    order_items,
    total_amount,
    subtotal_amount,
    discount_amount,
    order_status,
    current_date::text,
    coalesce(p_address, ''),
    coalesce(p_phone, ''),
    coalesce(p_email, ''),
    coalesce(p_note, ''),
    current_user_id,
    selected_promotion_id,
    selected_promotion_name,
    pricing_snapshot
  );

  insert into public.order_payment_authorizations (order_id, token_hash)
  values (order_id, encode(digest(payment_token, 'sha256'), 'hex'));

  return jsonb_build_object(
    'order_id', order_id,
    'member_role', member_role,
    'items', order_items,
    'subtotal', subtotal_amount,
    'discount', discount_amount,
    'shipping', shipping_amount,
    'total', total_amount,
    'status', order_status,
    'promotion_id', selected_promotion_id,
    'promotion_name', selected_promotion_name,
    'pricing_snapshot', pricing_snapshot,
    'payment_token', payment_token
  );
end;
$$;

revoke all on function public.create_order_with_pricing(
  jsonb, text, text, text, text, text, text
) from public;

grant execute on function public.create_order_with_pricing(
  jsonb, text, text, text, text, text, text
) to anon, authenticated;

create or replace function public.claim_order_payment(
  p_order_id text,
  p_payment_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  payment_auth public.order_payment_authorizations%rowtype;
  target_order public.orders%rowtype;
begin
  if nullif(trim(p_order_id), '') is null or nullif(trim(p_payment_token), '') is null then
    raise exception 'Order ID and payment token are required' using errcode = '22023';
  end if;

  select * into payment_auth
  from public.order_payment_authorizations
  where order_id = p_order_id
  for update;

  if not found
    or payment_auth.token_hash <> encode(digest(p_payment_token, 'sha256'), 'hex')
  then
    raise exception 'Invalid payment authorization' using errcode = '42501';
  end if;
  if payment_auth.gateway_created_at is not null then
    raise exception 'Payment has already been created' using errcode = '23505';
  end if;
  if payment_auth.claimed_at is not null then
    raise exception 'Payment creation is already in progress' using errcode = '55P03';
  end if;

  select * into target_order from public.orders where id = p_order_id;
  if not found or target_order.status not in ('awaiting_confirm', 'unpaid') then
    raise exception 'Order is not payable' using errcode = '22023';
  end if;
  if target_order.payment_due_at <= now() then
    raise exception 'Order payment has expired' using errcode = '22023';
  end if;

  update public.order_payment_authorizations
  set claimed_at = now()
  where order_id = p_order_id;

  return jsonb_build_object(
    'id', target_order.id,
    'total', target_order.total,
    'status', target_order.status,
    'items', target_order.items,
    'payment_due_at', target_order.payment_due_at
  );
end;
$$;

create or replace function public.complete_order_payment_claim(
  p_order_id text,
  p_payment_token text,
  p_success boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.order_payment_authorizations
  set
    claimed_at = case when p_success then claimed_at else null end,
    gateway_created_at = case when p_success then now() else gateway_created_at end
  where order_id = p_order_id
    and token_hash = encode(digest(p_payment_token, 'sha256'), 'hex');

  if not found then
    raise exception 'Invalid payment authorization' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.authorize_order_payment_access(
  p_order_id text,
  p_payment_token text
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.order_payment_authorizations
    where order_id = p_order_id
      and token_hash = encode(digest(p_payment_token, 'sha256'), 'hex')
  );
$$;

revoke all on function public.claim_order_payment(text, text) from public;
revoke all on function public.complete_order_payment_claim(text, text, boolean) from public;
revoke all on function public.authorize_order_payment_access(text, text) from public;
grant execute on function public.claim_order_payment(text, text) to service_role;
grant execute on function public.complete_order_payment_claim(text, text, boolean) to service_role;
grant execute on function public.authorize_order_payment_access(text, text) to service_role;

-- Orders may only be created through the authoritative RPC.
drop policy if exists "orders_insert_all" on public.orders;

-- Browser users may no longer mutate totals, items or payment status directly.
-- Admin order updates should move to a dedicated RPC in the status-authority phase.
drop policy if exists "orders_update_all" on public.orders;

create or replace function public.is_eclado_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = any(array[
    'baby90522@gmail.com',
    'ecladotaiwan@gmail.com',
    'k0919933386@gmail.com',
    'line.u6f71cfa36c3fb2188f54396a5cb58882@ecladotaiwan.com'
  ]);
$$;

revoke all on function public.is_eclado_admin() from public;
grant execute on function public.is_eclado_admin() to authenticated;

drop policy if exists "orders_update_admin" on public.orders;
create policy "orders_update_admin"
  on public.orders for update
  to authenticated
  using (public.is_eclado_admin())
  with check (public.is_eclado_admin());

comment on function public.create_order_with_pricing(
  jsonb, text, text, text, text, text, text
) is 'Creates an order using authoritative prices and one best live promotion, with an immutable versioned pricing snapshot.';

comment on function public.calculate_order_shipping(jsonb) is
  'Authoritative shipping rule v1: carts containing only product 9 are free; all other carts cost TWD 120.';

create or replace function public.protect_order_pricing_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.items is distinct from old.items
    or new.total is distinct from old.total
    or new.subtotal is distinct from old.subtotal
    or new.discount is distinct from old.discount
    or new.type is distinct from old.type
    or new.promotion_name is distinct from old.promotion_name
    or new.pricing_snapshot is distinct from old.pricing_snapshot
  then
    raise exception 'Order pricing snapshot is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_order_pricing_snapshot on public.orders;
create trigger trg_protect_order_pricing_snapshot
  before update on public.orders
  for each row execute function public.protect_order_pricing_snapshot();

comment on column public.orders.pricing_snapshot is
  'Immutable versioned snapshot of authoritative item prices, promotion formula, shipping and total.';
