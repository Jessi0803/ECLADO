-- ECLADO product integer sequence + immutable Storage asset key
-- Safe to rerun. Existing product IDs are preserved.

create extension if not exists pgcrypto;

create sequence if not exists public.products_id_seq as integer;

alter sequence public.products_id_seq owned by public.products.id;

alter table public.products
  alter column id set default nextval('public.products_id_seq'::regclass);

select setval(
  'public.products_id_seq'::regclass,
  greatest(coalesce((select max(id) from public.products), 0) + 1, 1),
  false
);

alter table public.products
  add column if not exists asset_key uuid default gen_random_uuid();

update public.products
set asset_key = gen_random_uuid()
where asset_key is null;

alter table public.products
  alter column asset_key set default gen_random_uuid(),
  alter column asset_key set not null;

create unique index if not exists products_asset_key_unique
  on public.products(asset_key);

comment on column public.products.asset_key is
  'Immutable UUID used as the product folder key in Supabase Storage.';

-- Verification: next sequence value must be greater than every existing ID.
select
  (select max(id) from public.products) as current_max_id,
  last_value as configured_next_id,
  is_called
from public.products_id_seq;

-- This query must return zero rows.
select asset_key, count(*)
from public.products
group by asset_key
having asset_key is null or count(*) > 1;
