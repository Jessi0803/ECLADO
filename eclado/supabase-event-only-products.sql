-- ECLADO unlisted event-only storefront.
-- Apply after product publication status, product variants/images, backoffice
-- permissions and security hardening. Re-apply the updated transactional
-- product-save and authoritative-pricing migrations in this release as well.

alter table public.products
  drop constraint if exists products_publication_status_check;

alter table public.products
  add constraint products_publication_status_check
  check (publication_status in ('draft', 'active', 'event_only', 'archived'));

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
  if p_publication_status not in ('draft', 'active', 'event_only', 'archived') then
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

create or replace function public.get_event_catalog()
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
      where product.publication_status = 'event_only'
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
        and product.publication_status = 'event_only'
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
        and product.publication_status = 'event_only'
    ), '[]'::jsonb)
  ) into payload;

  return payload;
end;
$$;

revoke all on function public.get_event_catalog() from public;
grant execute on function public.get_event_catalog() to anon, authenticated;

comment on function public.get_event_catalog() is
  'Returns a minimized event-only catalog for the unlisted event storefront.';
