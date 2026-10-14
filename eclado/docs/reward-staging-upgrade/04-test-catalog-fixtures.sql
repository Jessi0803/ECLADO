-- Test-only catalog fixtures for qqlgqasbmbicnmvnlqbr.
-- Requires 03-test-login-fixtures.sql. Never run against production.

begin;

do $$
declare
  test_product_id integer;
begin
  if (select count(*) from auth.users where lower(email) in (
    'admin.stage@eclado.test',
    'instructor.stage@eclado.test',
    'student.stage@eclado.test'
  )) <> 3 then
    raise exception 'Test Auth fixtures are required';
  end if;

  select id into test_product_id
  from public.products
  where lower(slug) = 'reward-system-test-product';

  if test_product_id is null then
    insert into public.products(
      name, name_zh, slug, category, series, size,
      price, pro_price, stock, min_stock,
      is_pro_only, active, publication_status,
      description, apply_tier_multiplier,
      instructor_price_multiplier, distributor_price_multiplier,
      staff_price_multiplier
    ) values(
      'reward-system-test-product', 'TEST 師資返饋驗收商品',
      'reward-system-test-product', 'toner', 'TEST', '100ml / 200ml',
      1200, 1000, 20, 0,
      false, true, 'active',
      '僅供 test Supabase 驗收學生價格、購物車與返饋快照。', true,
      null, null, null
    ) returning id into test_product_id;
  else
    update public.products
    set name = 'reward-system-test-product',
        name_zh = 'TEST 師資返饋驗收商品',
        category = 'toner', series = 'TEST', size = '100ml / 200ml',
        price = 1200, pro_price = 1000, stock = 20, min_stock = 0,
        is_pro_only = false, active = true, publication_status = 'active',
        description = '僅供 test Supabase 驗收學生價格、購物車與返饋快照。',
        instructor_price_multiplier = null,
        distributor_price_multiplier = null,
        staff_price_multiplier = null,
        updated_at = now()
    where id = test_product_id;
  end if;

  delete from public.product_variants
  where product_id = test_product_id
    and sku in ('TEST-REWARD-100', 'TEST-REWARD-200');

  insert into public.product_variants(
    product_id, sku, size, price, pro_price, stock,
    is_default, sort_order, active, is_custom_order
  ) values
    (test_product_id, 'TEST-REWARD-100', '100ml', 1200, 1000, 10, true, 0, true, false),
    (test_product_id, 'TEST-REWARD-200', '200ml', 2000, 1600, 10, false, 1, true, false);
end;
$$;

commit;

select jsonb_build_object(
  'product', jsonb_build_object(
    'id', product.id,
    'name', product.name_zh,
    'status', product.publication_status,
    'active', product.active,
    'base_price', product.price,
    'pro_price', product.pro_price
  ),
  'variants', (
    select jsonb_agg(jsonb_build_object(
      'sku', variant.sku,
      'size', variant.size,
      'price', variant.price,
      'pro_price', variant.pro_price,
      'stock', variant.stock,
      'default', variant.is_default
    ) order by variant.sort_order, variant.id)
    from public.product_variants variant
    where variant.product_id = product.id
  ),
  'student_pricing_enabled', (
    select enabled from public.student_pricing_feature_settings where singleton
  )
) as verification
from public.products product
where lower(product.slug) = 'reward-system-test-product';
