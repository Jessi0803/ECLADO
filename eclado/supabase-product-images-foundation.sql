-- ECLADO product image foundation (phase 1)
-- Prerequisites:
--   1. supabase-product-sequence-and-assets.sql
--   2. public.is_eclado_admin()
-- This phase creates storage/data/RLS only. It does not change current images.

create extension if not exists pgcrypto;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id integer not null references public.products(id) on delete cascade,
  storage_path text not null check (
    btrim(storage_path) <> ''
    and storage_path !~ '^/'
    and storage_path ~ '^products/[^/]+/[^/]+$'
  ),
  original_name text not null default '',
  alt_text text not null default '',
  sort_order integer not null default 0 check (sort_order >= 0),
  is_primary boolean not null default false,
  active boolean not null default true,
  mime_type text check (
    mime_type is null
    or mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  file_size integer check (file_size is null or file_size between 1 and 5242880),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_path)
);

create index if not exists product_images_product_order_idx
  on public.product_images(product_id, active desc, sort_order, id);

create unique index if not exists product_images_one_active_primary
  on public.product_images(product_id)
  where is_primary is true and active is true;

drop trigger if exists trg_product_images_updated_at on public.product_images;
create trigger trg_product_images_updated_at
  before update on public.product_images
  for each row execute function public.set_updated_at();

alter table public.product_images enable row level security;

drop policy if exists "product_images_select_active" on public.product_images;
drop policy if exists "product_images_select_admin" on public.product_images;
drop policy if exists "product_images_insert_admin" on public.product_images;
drop policy if exists "product_images_update_admin" on public.product_images;
drop policy if exists "product_images_delete_admin" on public.product_images;

create policy "product_images_select_active"
  on public.product_images for select to anon, authenticated
  using (
    active is true
    and exists (
      select 1
      from public.products product
      where product.id = product_images.product_id
        and product.active is true
    )
  );

create policy "product_images_select_admin"
  on public.product_images for select to authenticated
  using (public.has_backoffice_permission('catalog.read'));

create policy "product_images_insert_admin"
  on public.product_images for insert to authenticated
  with check (
    public.has_backoffice_permission('catalog.write')
    and exists (
      select 1
      from public.products product
      where product.id = product_images.product_id
        and split_part(product_images.storage_path, '/', 1) = 'products'
        and split_part(product_images.storage_path, '/', 2) = product.asset_key::text
    )
  );

create policy "product_images_update_admin"
  on public.product_images for update to authenticated
  using (public.has_backoffice_permission('catalog.write'))
  with check (
    public.has_backoffice_permission('catalog.write')
    and exists (
      select 1
      from public.products product
      where product.id = product_images.product_id
        and split_part(product_images.storage_path, '/', 1) = 'products'
        and split_part(product_images.storage_path, '/', 2) = product.asset_key::text
    )
  );

create policy "product_images_delete_admin"
  on public.product_images for delete to authenticated
  using (public.has_backoffice_permission('catalog.write'));

grant select on public.product_images to anon, authenticated;
grant insert, update, delete on public.product_images to authenticated;

drop policy if exists "product_images_storage_select_linked" on storage.objects;
drop policy if exists "product_images_storage_select_admin" on storage.objects;
drop policy if exists "product_images_storage_insert_admin" on storage.objects;
drop policy if exists "product_images_storage_update_admin" on storage.objects;
drop policy if exists "product_images_storage_delete_admin" on storage.objects;

create policy "product_images_storage_select_linked"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'product-images'
    and exists (
      select 1
      from public.product_images image
      join public.products product on product.id = image.product_id
      where image.storage_path = storage.objects.name
        and image.active is true
        and product.active is true
    )
  );

create policy "product_images_storage_select_admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'product-images'
    and public.has_backoffice_permission('catalog.read')
  );

create policy "product_images_storage_insert_admin"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = 'products'
    and public.has_backoffice_permission('catalog.write')
  );

create policy "product_images_storage_update_admin"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and public.has_backoffice_permission('catalog.write')
  )
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = 'products'
    and public.has_backoffice_permission('catalog.write')
  );

create policy "product_images_storage_delete_admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and public.has_backoffice_permission('catalog.write')
  );

comment on table public.product_images is
  'Product image metadata. One Storage object equals one row.';
comment on column public.product_images.storage_path is
  'Object path inside the product-images bucket; never a full public URL.';
comment on column public.product_images.is_primary is
  'True for the single active primary image of a product.';

-- Verification report.
select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'product-images';

select
  count(*) as existing_image_rows,
  count(*) filter (where active is true and is_primary is true) as active_primary_rows
from public.product_images;
