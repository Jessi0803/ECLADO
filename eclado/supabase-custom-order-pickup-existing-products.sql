-- One-time data migration for the existing custom-order catalog.
-- Run after supabase-authoritative-pricing.sql and
-- supabase-save-product-with-variants.sql.

update public.product_variants variant
set is_custom_order = true,
    updated_at = now()
from public.products product
where product.id = variant.product_id
  and product.id in (143, 150, 151)
  and (
    product.name in ('客訂', '客訂1', '客訂2')
    or product.name_zh in ('客訂', '客訂1', '客訂2')
  );

select
  count(*) filter (where variant.is_custom_order) as marked_variants,
  count(distinct product.id) filter (where variant.is_custom_order) as marked_products
from public.product_variants variant
join public.products product on product.id = variant.product_id
where product.id in (143, 150, 151);
