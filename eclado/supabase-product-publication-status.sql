-- ECLADO product publication lifecycle
-- Run once in Supabase SQL Editor after supabase-core-rls-hardening.sql.
--
-- publication_status is authoritative:
--   draft    = admin-only work in progress
--   active   = visible and purchasable
--   archived = previously published, now hidden
--
-- The legacy active boolean is retained temporarily for compatibility.

alter table public.products
  add column if not exists publication_status text;

update public.products
set publication_status = case
  when active is true then 'active'
  else 'archived'
end
where publication_status is null;

alter table public.products
  alter column publication_status set default 'draft',
  alter column publication_status set not null;

alter table public.products
  drop constraint if exists products_publication_status_check;

alter table public.products
  add constraint products_publication_status_check
  check (publication_status in ('draft', 'active', 'archived'));

create index if not exists products_publication_status_idx
  on public.products(publication_status, id);

create or replace function public.sync_product_publication_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
    and new.publication_status is not distinct from old.publication_status
    and new.active is distinct from old.active
  then
    -- Temporary compatibility for older admin/API clients.
    new.publication_status := case when new.active then 'active' else 'archived' end;
  else
    new.active := new.publication_status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_sync_publication_status on public.products;
create trigger trg_products_sync_publication_status
  before insert or update on public.products
  for each row execute function public.sync_product_publication_status();

drop policy if exists "products_select_active" on public.products;
create policy "products_select_active"
  on public.products for select to anon, authenticated
  using (publication_status = 'active');

drop policy if exists "product_variants_select_active" on public.product_variants;
create policy "product_variants_select_active"
  on public.product_variants for select to anon, authenticated
  using (
    active is true
    and exists (
      select 1
      from public.products product
      where product.id = product_variants.product_id
        and product.publication_status = 'active'
    )
  );

drop policy if exists "product_images_select_active" on public.product_images;
create policy "product_images_select_active"
  on public.product_images for select to anon, authenticated
  using (
    active is true
    and exists (
      select 1
      from public.products product
      where product.id = product_images.product_id
        and product.publication_status = 'active'
    )
  );

comment on column public.products.publication_status is
  'Product lifecycle: draft (admin only), active (public), archived (hidden).';

select publication_status, count(*)
from public.products
group by publication_status
order by publication_status;
