-- ECLADO procurement v2: use storefront products/product_variants directly.
-- Preconditions: the procurement feature has no saved purchase orders yet.
-- This migration intentionally removes the unused supplier catalog tables.

begin;

do $$
begin
  if exists (select 1 from public.purchase_orders limit 1) then
    raise exception 'Procurement v2 migration requires purchase_orders to be empty';
  end if;
  if exists (select 1 from public.purchase_order_items limit 1) then
    raise exception 'Procurement v2 migration requires purchase_order_items to be empty';
  end if;
end;
$$;

alter table public.product_variants
  add column if not exists procurement_unit_cost_usd numeric(14, 4);

alter table public.product_variants
  drop constraint if exists product_variants_procurement_unit_cost_nonnegative;
alter table public.product_variants
  add constraint product_variants_procurement_unit_cost_nonnegative
  check (procurement_unit_cost_usd is null or procurement_unit_cost_usd >= 0);

-- Preserve the current USD cost for every linked storefront variant before the
-- legacy supplier catalog is removed.
update public.product_variants variant
set procurement_unit_cost_usd = source.unit_cost
from (
  select distinct on (link.product_variant_id)
    link.product_variant_id,
    price.unit_cost
  from public.supplier_item_variant_links link
  join public.supplier_item_prices price
    on price.supplier_item_id = link.supplier_item_id
   and price.effective_from <= now()
   and (price.effective_to is null or price.effective_to > now())
  order by link.product_variant_id, link.is_primary desc, price.effective_from desc, price.id desc
) source
where variant.id = source.product_variant_id;

drop function if exists public.get_procurement_management_data();
drop function if exists public.save_purchase_order(jsonb, jsonb);
drop function if exists public.set_supplier_item_price(bigint, numeric, text, timestamptz, text);

alter table public.purchase_orders
  drop column if exists supplier_id;

alter table public.purchase_order_items
  drop constraint if exists purchase_order_items_unique_item,
  drop column if exists supplier_price_id,
  drop column if exists supplier_item_id;

alter table public.purchase_order_items
  rename column supplier_sku to product_sku;

alter table public.purchase_order_items
  add column if not exists product_variant_id bigint;
alter table public.purchase_order_items
  alter column product_variant_id set not null;
alter table public.purchase_order_items
  add constraint purchase_order_items_product_variant_fkey
  foreign key (product_variant_id) references public.product_variants(id) on delete restrict;
alter table public.purchase_order_items
  add constraint purchase_order_items_unique_variant
  unique (purchase_order_id, product_variant_id);

drop table if exists public.supplier_item_variant_links;
drop table if exists public.supplier_item_prices;
drop table if exists public.supplier_items;
drop table if exists public.suppliers;

create or replace function public.get_procurement_management_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  if not public.is_eclado_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'product_variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', variant.id,
        'product_id', product.id,
        'sku', variant.sku,
        'name_zh', product.name_zh,
        'name_en', product.name,
        'specification', variant.size,
        'active', variant.active,
        'unit_cost', variant.procurement_unit_cost_usd,
        'cost_configured', variant.procurement_unit_cost_usd is not null,
        'available_stock', variant.stock
      ) order by product.name_zh, variant.sort_order, variant.id)
      from public.product_variants variant
      join public.products product on product.id = variant.product_id
      where variant.active is true
    ), '[]'::jsonb),
    'addresses', coalesce((
      select jsonb_agg(to_jsonb(address) order by address.is_default desc, address.last_used_at desc nulls last, address.id desc)
      from public.procurement_addresses address where address.active is true
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(
        to_jsonb(purchase_order) || jsonb_build_object(
          'supplier_name', 'ECLADO',
          'supplier_code', 'ECLADO',
          'items', coalesce((
            select jsonb_agg(to_jsonb(order_item) order by order_item.sort_order, order_item.id)
            from public.purchase_order_items order_item
            where order_item.purchase_order_id = purchase_order.id
          ), '[]'::jsonb)
        ) order by purchase_order.created_at desc, purchase_order.id desc
      )
      from public.purchase_orders purchase_order
    ), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$$;

revoke all on function public.get_procurement_management_data() from public, anon;
grant execute on function public.get_procurement_management_data() to authenticated;

create or replace function public.save_purchase_order(p_order jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_id bigint := nullif(p_order ->> 'id', '')::bigint;
  exchange_rate_value numeric := nullif(p_order ->> 'exchange_rate', '')::numeric;
  status_value text := coalesce(nullif(btrim(p_order ->> 'status'), ''), 'draft');
  address_value jsonb := coalesce(p_order -> 'shipping_address', '{}'::jsonb);
  total_usd_value numeric(14, 2) := 0;
  total_twd_value numeric(14, 2) := 0;
  saved_order public.purchase_orders%rowtype;
  item_value jsonb;
  variant_row record;
  product_variant_id_value bigint;
  quantity_value integer;
  unit_cost_value numeric;
  item_index integer := 0;
begin
  if not public.is_eclado_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if exchange_rate_value is null or exchange_rate_value <= 0 then
    raise exception 'Exchange rate must be greater than zero' using errcode = '22023';
  end if;
  if status_value not in ('draft', 'pending') then
    raise exception 'New or edited order status must be draft or pending' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one purchase item is required' using errcode = '22023';
  end if;
  if status_value <> 'draft' and btrim(coalesce(address_value ->> 'address_text', '')) = '' then
    raise exception 'Shipping address is required' using errcode = '22023';
  end if;

  for item_value in select value from jsonb_array_elements(p_items)
  loop
    product_variant_id_value := nullif(item_value ->> 'product_variant_id', '')::bigint;
    quantity_value := nullif(item_value ->> 'quantity', '')::integer;
    unit_cost_value := nullif(item_value ->> 'unit_cost', '')::numeric;
    if product_variant_id_value is null or quantity_value is null or quantity_value <= 0
      or unit_cost_value is null or unit_cost_value < 0 then
      raise exception 'Item variant, quantity and unit cost are invalid' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from public.product_variants variant
      join public.products product on product.id = variant.product_id
      where variant.id = product_variant_id_value
        and variant.active is true
        and variant.procurement_unit_cost_usd is not null
    ) then
      raise exception 'Active product variant with procurement cost is required' using errcode = 'P0002';
    end if;
    total_usd_value := total_usd_value + round(quantity_value * unit_cost_value, 2);
  end loop;
  total_twd_value := round(total_usd_value * exchange_rate_value, 2);

  if order_id is null then
    insert into public.purchase_orders (
      status, exchange_rate, total_usd, total_twd,
      shipping_address, notes, created_by
    ) values (
      status_value, exchange_rate_value, total_usd_value, total_twd_value,
      address_value, nullif(btrim(p_order ->> 'notes'), ''), auth.uid()
    ) returning * into saved_order;
    order_id := saved_order.id;
  else
    update public.purchase_orders set
      status = status_value,
      exchange_rate = exchange_rate_value,
      total_usd = total_usd_value,
      total_twd = total_twd_value,
      shipping_address = address_value,
      notes = nullif(btrim(p_order ->> 'notes'), '')
    where id = order_id and status in ('draft', 'pending')
    returning * into saved_order;
    if saved_order.id is null then
      raise exception 'Editable purchase order not found' using errcode = 'P0002';
    end if;
    delete from public.purchase_order_items where purchase_order_id = order_id;
  end if;

  for item_value in select value from jsonb_array_elements(p_items)
  loop
    product_variant_id_value := (item_value ->> 'product_variant_id')::bigint;
    select
      variant.id,
      variant.sku,
      variant.size,
      variant.stock,
      variant.procurement_unit_cost_usd,
      product.name_zh,
      product.name as name_en
    into variant_row
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where variant.id = product_variant_id_value
      and variant.active is true
      and variant.procurement_unit_cost_usd is not null;
    if variant_row.id is null then
      raise exception 'Product variant not found' using errcode = 'P0002';
    end if;

    quantity_value := (item_value ->> 'quantity')::integer;
    unit_cost_value := (item_value ->> 'unit_cost')::numeric;

    insert into public.purchase_order_items (
      purchase_order_id, product_variant_id,
      product_sku, name_zh, name_en, specification,
      quantity, unit_cost, subtotal_usd, stock_at_order, sort_order
    ) values (
      order_id, variant_row.id,
      variant_row.sku, variant_row.name_zh, variant_row.name_en, variant_row.size,
      quantity_value, unit_cost_value, round(quantity_value * unit_cost_value, 2),
      variant_row.stock, item_index
    );
    item_index := item_index + 1;
  end loop;

  if nullif(p_order ->> 'address_id', '') is not null then
    update public.procurement_addresses set
      usage_count = usage_count + 1,
      last_used_at = now()
    where id = (p_order ->> 'address_id')::bigint and active is true;
  end if;

  return jsonb_build_object(
    'id', saved_order.id,
    'po_number', saved_order.po_number,
    'status', saved_order.status,
    'total_usd', saved_order.total_usd,
    'total_twd', saved_order.total_twd
  );
end;
$$;

revoke all on function public.save_purchase_order(jsonb, jsonb) from public, anon;
grant execute on function public.save_purchase_order(jsonb, jsonb) to authenticated;

comment on column public.product_variants.procurement_unit_cost_usd is
  'Current USD procurement cost. NULL means the variant cannot be selected for procurement.';
comment on table public.purchase_order_items is
  'Fixed product, price and inventory snapshots for each purchase order line.';

commit;
