-- ECLADO product variants foundation (phase 1)
-- Run after supabase-core-rls-hardening.sql.
-- This migration does not move products.variants JSON or change frontend behavior.

create table if not exists public.product_variants (
  id bigserial primary key,
  product_id integer not null references public.products(id) on delete cascade,
  sku text,
  size text,
  price numeric not null default 0,
  pro_price numeric not null default 0,
  stock integer,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  is_custom_order boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.product_variants add column if not exists sku text;
alter table public.product_variants add column if not exists size text;
alter table public.product_variants add column if not exists price numeric not null default 0;
alter table public.product_variants add column if not exists pro_price numeric not null default 0;
alter table public.product_variants add column if not exists stock integer;
alter table public.product_variants add column if not exists is_default boolean not null default false;
alter table public.product_variants add column if not exists sort_order integer not null default 0;
alter table public.product_variants add column if not exists active boolean not null default true;
alter table public.product_variants add column if not exists is_custom_order boolean not null default false;
alter table public.product_variants add column if not exists created_at timestamptz not null default now();
alter table public.product_variants add column if not exists updated_at timestamptz not null default now();

-- Safely normalize existing rows before adding strict constraints.
update public.product_variants variant
set
  sku = case
    when nullif(trim(variant.sku), '') is null
      then 'P' || variant.product_id || '-V' || variant.id
    else trim(variant.sku)
  end,
  size = coalesce(
    nullif(trim(variant.size), ''),
    nullif(trim(product.size), ''),
    '規格 ' || variant.id
  ),
  price = greatest(coalesce(variant.price, 0), 0),
  pro_price = greatest(coalesce(variant.pro_price, 0), 0),
  stock = greatest(coalesce(variant.stock, product.stock, 0), 0),
  sort_order = greatest(coalesce(variant.sort_order, 0), 0)
from public.products product
where product.id = variant.product_id;

-- Resolve any pre-existing duplicate SKU values deterministically.
with duplicate_skus as (
  select
    id,
    row_number() over (
      partition by product_id, lower(sku)
      order by id
    ) as duplicate_number
  from public.product_variants
)
update public.product_variants variant
set sku = variant.sku || '-' || variant.id
from duplicate_skus duplicate
where duplicate.id = variant.id
  and duplicate.duplicate_number > 1;

-- Keep at most one existing default per product.
with ranked_defaults as (
  select
    id,
    row_number() over (
      partition by product_id
      order by active desc, sort_order, id
    ) as default_number
  from public.product_variants
  where is_default is true
)
update public.product_variants variant
set is_default = false
from ranked_defaults ranked
where ranked.id = variant.id
  and ranked.default_number > 1;

-- Give products that already have variants one deterministic default.
with missing_defaults as (
  select distinct on (variant.product_id) variant.id
  from public.product_variants variant
  where not exists (
    select 1
    from public.product_variants existing
    where existing.product_id = variant.product_id
      and existing.is_default is true
  )
  order by variant.product_id, variant.active desc, variant.sort_order, variant.id
)
update public.product_variants variant
set is_default = true
from missing_defaults missing
where missing.id = variant.id;

alter table public.product_variants alter column sku set not null;
alter table public.product_variants alter column size set not null;
alter table public.product_variants alter column stock set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'product_variants_sku_not_blank'
      and conrelid = 'public.product_variants'::regclass
  ) then
    alter table public.product_variants
      add constraint product_variants_sku_not_blank check (btrim(sku) <> '');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'product_variants_size_not_blank'
      and conrelid = 'public.product_variants'::regclass
  ) then
    alter table public.product_variants
      add constraint product_variants_size_not_blank check (btrim(size) <> '');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'product_variants_prices_nonnegative'
      and conrelid = 'public.product_variants'::regclass
  ) then
    alter table public.product_variants
      add constraint product_variants_prices_nonnegative
      check (price >= 0 and pro_price >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'product_variants_stock_nonnegative'
      and conrelid = 'public.product_variants'::regclass
  ) then
    alter table public.product_variants
      add constraint product_variants_stock_nonnegative check (stock >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'product_variants_sort_order_nonnegative'
      and conrelid = 'public.product_variants'::regclass
  ) then
    alter table public.product_variants
      add constraint product_variants_sort_order_nonnegative check (sort_order >= 0);
  end if;
end
$$;

create unique index if not exists product_variants_product_sku_unique
  on public.product_variants (product_id, lower(sku));

create unique index if not exists product_variants_one_default_per_product
  on public.product_variants (product_id)
  where is_default is true;

create index if not exists idx_product_variants_product_sort
  on public.product_variants (product_id, active desc, sort_order, id);

create or replace function public.prepare_product_variant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.sku := btrim(new.sku);
  new.size := btrim(new.size);
  new.updated_at := now();

  if new.is_default is true then
    update public.product_variants
    set is_default = false
    where product_id = new.product_id
      and id is distinct from new.id
      and is_default is true;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prepare_product_variant on public.product_variants;
create trigger trg_prepare_product_variant
  before insert or update on public.product_variants
  for each row execute function public.prepare_product_variant();

create or replace function public.enforce_product_variant_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_product_id integer;
  variant_count integer;
  default_count integer;
begin
  target_product_id := coalesce(new.product_id, old.product_id);

  select
    count(*),
    count(*) filter (where is_default is true)
  into variant_count, default_count
  from public.product_variants
  where product_id = target_product_id;

  if variant_count > 0 and default_count <> 1 then
    raise exception 'Product % must have exactly one default variant', target_product_id
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.product_id is distinct from new.product_id then
    select
      count(*),
      count(*) filter (where is_default is true)
    into variant_count, default_count
    from public.product_variants
    where product_id = old.product_id;

    if variant_count > 0 and default_count <> 1 then
      raise exception 'Product % must have exactly one default variant', old.product_id
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_product_variant_default on public.product_variants;
create constraint trigger trg_enforce_product_variant_default
  after insert or update or delete on public.product_variants
  deferrable initially deferred
  for each row execute function public.enforce_product_variant_default();

alter table public.product_variants enable row level security;
drop policy if exists "product_variants_select_all" on public.product_variants;
drop policy if exists "product_variants_insert_all" on public.product_variants;
drop policy if exists "product_variants_update_all" on public.product_variants;
drop policy if exists "product_variants_delete_all" on public.product_variants;
drop policy if exists "product_variants_select_active" on public.product_variants;
drop policy if exists "product_variants_select_admin" on public.product_variants;
drop policy if exists "product_variants_insert_admin" on public.product_variants;
drop policy if exists "product_variants_update_admin" on public.product_variants;

create policy "product_variants_select_active"
  on public.product_variants for select to anon, authenticated
  using (
    active is true
    and exists (
      select 1
      from public.products product
      where product.id = product_variants.product_id
        and product.active is true
    )
  );

create policy "product_variants_select_admin"
  on public.product_variants for select to authenticated
  using (public.is_eclado_admin());

create policy "product_variants_insert_admin"
  on public.product_variants for insert to authenticated
  with check (public.is_eclado_admin());

create policy "product_variants_update_admin"
  on public.product_variants for update to authenticated
  using (public.is_eclado_admin())
  with check (public.is_eclado_admin());

revoke insert, update, delete on public.product_variants from anon;
revoke delete on public.product_variants from authenticated;
grant select on public.product_variants to anon, authenticated;
grant insert, update on public.product_variants to authenticated;

revoke all on function public.prepare_product_variant() from public;
revoke all on function public.enforce_product_variant_default() from public;

select
  product_id,
  count(*) as variant_count,
  count(*) filter (where is_default is true) as default_count
from public.product_variants
group by product_id
order by product_id;
