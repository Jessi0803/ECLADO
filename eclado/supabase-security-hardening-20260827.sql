-- ECLADO storefront data minimization + shared rate limiting.
-- Run after the product variants/images, publication status, admin users,
-- authoritative pricing and core RLS migrations.

create extension if not exists pgcrypto;

-- Public storefront callers receive only fields required to render the shop.
-- Exact stock is reduced to 0/1 availability, SKU/min_stock are omitted, and
-- professional prices are only included for approved professional roles.
create or replace function public.get_storefront_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer_role text := 'consumer';
  can_view_professional_price boolean := false;
  payload jsonb;
begin
  if auth.uid() is not null then
    select coalesce(profile.role, 'consumer')
      into viewer_role
    from public.profiles profile
    where profile.id = auth.uid();
  end if;
  can_view_professional_price := viewer_role in ('pro', 'instructor', 'distributor');

  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(
        (to_jsonb(product) - array[
          'min_stock', 'pro_price', 'stock', 'variants',
          'created_at', 'updated_at'
        ]) || jsonb_build_object(
          'pro_price', case when can_view_professional_price then product.pro_price else null end,
          'stock', case when product.stock > 0 then 1 else 0 end
        )
        order by product.id
      )
      from public.products product
      where product.publication_status = 'active'
        and product.active is true
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(
        (to_jsonb(variant) - array[
          'sku', 'pro_price', 'stock', 'created_at', 'updated_at'
        ]) || jsonb_build_object(
          'pro_price', case when can_view_professional_price then variant.pro_price else null end,
          'stock', case when variant.stock > 0 then 1 else 0 end
        )
        order by variant.product_id, variant.sort_order, variant.id
      )
      from public.product_variants variant
      join public.products product on product.id = variant.product_id
      where variant.active is true
        and product.publication_status = 'active'
        and product.active is true
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', image.id,
          'product_id', image.product_id,
          'storage_path', image.storage_path,
          'alt_text', image.alt_text,
          'sort_order', image.sort_order,
          'is_primary', image.is_primary,
          'active', image.active
        )
        order by image.product_id, image.sort_order, image.id
      )
      from public.product_images image
      join public.products product on product.id = image.product_id
      where image.active is true
        and product.publication_status = 'active'
        and product.active is true
    ), '[]'::jsonb)
  ) into payload;

  return payload;
end;
$$;

revoke all on function public.get_storefront_catalog() from public;
grant execute on function public.get_storefront_catalog() to anon, authenticated;

-- Administrators use a separate guarded RPC so removing broad table SELECT
-- does not remove inventory-management functionality.
create or replace function public.get_admin_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  if not public.has_backoffice_permission('catalog.read') then
    raise exception 'Catalog read access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'products', coalesce((select jsonb_agg(to_jsonb(product) order by product.id) from public.products product), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(
      case
        when public.has_backoffice_permission('procurement.manage') then to_jsonb(variant)
        else to_jsonb(variant) - 'procurement_unit_cost_usd'
      end
      order by variant.product_id, variant.sort_order, variant.id
    ) from public.product_variants variant), '[]'::jsonb),
    'images', coalesce((select jsonb_agg(to_jsonb(image) order by image.product_id, image.sort_order, image.id) from public.product_images image where image.active is true), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$$;

revoke all on function public.get_admin_catalog() from public;
grant execute on function public.get_admin_catalog() to authenticated;

create or replace function public.set_product_publication_status(
  p_product_id integer,
  p_publication_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_backoffice_permission('catalog.write') then
    raise exception 'Catalog write access required' using errcode = '42501';
  end if;
  if p_publication_status not in ('draft', 'active', 'archived') then
    raise exception 'Invalid publication status' using errcode = '22023';
  end if;
  update public.products
  set publication_status = p_publication_status
  where id = p_product_id;
  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_product_publication_status(integer, text) from public;
grant execute on function public.set_product_publication_status(integer, text) to authenticated;

-- The storefront needs aggregate popularity only, never raw order items.
create or replace function public.get_public_sales_stats()
returns table(product_id integer, sold_qty bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (item.value ->> 'product_id')::integer as product_id,
    sum(greatest(coalesce(nullif(item.value ->> 'qty', '')::integer, 1), 1))::bigint as sold_qty
  from public.orders orders
  cross join lateral jsonb_array_elements(orders.items) item(value)
  where orders.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')
    and coalesce(item.value ->> 'product_id', '') ~ '^[0-9]+$'
    and coalesce(item.value ->> 'is_custom_order', 'false') <> 'true'
  group by (item.value ->> 'product_id')::integer;
$$;

revoke all on function public.get_public_sales_orders() from anon, authenticated;
revoke all on function public.get_public_sales_stats() from public;
grant execute on function public.get_public_sales_stats() to anon, authenticated;

-- Direct table reads previously allowed select('*') to disclose private
-- pricing/inventory metadata. All storefront/admin reads now go through the
-- purpose-specific functions above; existing RLS still protects mutations.
revoke select on table public.products from anon, authenticated;
revoke select on table public.product_variants from anon, authenticated;
revoke select on table public.product_images from anon, authenticated;

create table if not exists public.api_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash, window_started_at)
);

alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from anon, authenticated;

create or replace function public.consume_rate_limit_internal(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  bucket_start timestamptz;
  next_count integer;
begin
  if p_scope !~ '^[a-z0-9:_-]{1,80}$'
     or p_key_hash !~ '^[a-f0-9]{64}$'
     or p_limit not between 1 and 10000
     or p_window_seconds not between 10 and 86400 then
    raise exception 'Invalid rate limit parameters' using errcode = '22023';
  end if;

  bucket_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits(scope, key_hash, window_started_at, request_count)
  values (p_scope, p_key_hash, bucket_start, 1)
  on conflict (scope, key_hash, window_started_at)
  do update set
    request_count = public.api_rate_limits.request_count + 1,
    updated_at = now()
  returning request_count into next_count;

  delete from public.api_rate_limits
  where window_started_at < now() - interval '2 days';

  return next_count <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit_internal(text, text, integer, integer) from public;

create or replace function public.consume_service_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  return public.consume_rate_limit_internal(p_scope, p_key_hash, p_limit, p_window_seconds);
end;
$$;

revoke all on function public.consume_service_rate_limit(text, text, integer, integer) from public;
grant execute on function public.consume_service_rate_limit(text, text, integer, integer) to service_role;

create or replace function public.enforce_order_creation_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text := coalesce(auth.role(), '');
  identity_value text;
  identity_hash text;
begin
  if caller_role not in ('anon', 'authenticated') then
    return new;
  end if;

  if length(coalesce(new.member, '')) > 100
     or length(coalesce(new.email, '')) > 254
     or length(coalesce(new.phone, '')) > 30
     or length(coalesce(new.address, '')) > 500
     or length(coalesce(new.note, '')) > 1000 then
    raise exception 'Order contact fields are too long' using errcode = '22001';
  end if;

  identity_value := case
    when new.user_id is not null then 'user:' || new.user_id::text
    else 'guest:' || lower(trim(coalesce(new.email, ''))) || ':' || regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g')
  end;
  identity_hash := encode(
    extensions.digest(identity_value::text, 'sha256'::text),
    'hex'
  );

  if not public.consume_rate_limit_internal('order:create', identity_hash, 8, 900) then
    raise exception 'Too many order attempts. Please try again later.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_order_creation_rate_limit() from public;
drop trigger if exists trg_orders_creation_rate_limit on public.orders;
create trigger trg_orders_creation_rate_limit
  before insert on public.orders
  for each row execute function public.enforce_order_creation_rate_limit();

comment on function public.get_storefront_catalog() is
  'Returns active storefront products with role-aware pricing and availability-only stock.';
comment on function public.get_public_sales_stats() is
  'Returns aggregate sold quantity by product without exposing order or line-item details.';
comment on table public.api_rate_limits is
  'Shared fixed-window counters keyed only by one-way hashes; no raw IP or identity is stored.';
