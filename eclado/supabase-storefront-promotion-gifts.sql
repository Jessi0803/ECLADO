-- Apply after supabase-promotion-multi-gifts.sql.
begin;

create or replace function public.get_storefront_promotion_gifts()
returns table (
  promotion_id uuid,
  variant_id bigint,
  product_id integer,
  publication_status text,
  quantity integer,
  name text,
  size text,
  image_path text,
  image_url text
)
language sql stable security definer set search_path = '' as $$
  with viewer as (
    select auth.uid() as id, coalesce((
      select case when profile.role in ('consumer', 'pro', 'instructor', 'distributor', 'staff')
        then profile.role else 'consumer' end
      from public.profiles profile
      where profile.id = auth.uid()
    ), 'consumer') as role
  )
  select promotion.id, reward.variant_id, product.id, product.publication_status, reward.quantity,
    coalesce(nullif(product.name_zh, ''), product.name), variant.size,
    image.storage_path, coalesce(nullif(product.image_url, ''), product.image_urls ->> 0)
  from public.promotions promotion
  cross join viewer
  join lateral (
    select saved.variant_id, saved.quantity, saved.sort_order
    from public.promotion_gift_rewards saved
    where saved.promotion_id = promotion.id
    union all
    select promotion.gift_variant_id, promotion.gift_quantity, 0
    where promotion.gift_variant_id is not null and promotion.gift_quantity > 0
      and not exists (
        select 1 from public.promotion_gift_rewards saved where saved.promotion_id = promotion.id
      )
  ) reward on true
  join public.product_variants variant on variant.id = reward.variant_id
  join public.products product on product.id = variant.product_id
  left join lateral (
    select entry.storage_path
    from public.product_images entry
    where entry.product_id = product.id and entry.active
    order by entry.is_primary desc, entry.sort_order, entry.id
    limit 1
  ) image on true
  where promotion.active and promotion.archived_at is null
    and promotion.activation_type = 'automatic'
    and promotion.benefit_type in ('amount_gift', 'quantity_gift')
    and (promotion.start_at is null or promotion.start_at <= now())
    and (promotion.end_at is null or promotion.end_at > now())
    and public.automatic_promotion_allows_identity(promotion.id, viewer.role, viewer.id)
    and variant.active and variant.gift_enabled
    and product.publication_status in ('active', 'event_only', 'gift_only')
  order by promotion.id, reward.sort_order, reward.variant_id;
$$;

revoke all on function public.get_storefront_promotion_gifts() from public;
grant execute on function public.get_storefront_promotion_gifts() to anon, authenticated;

commit;
