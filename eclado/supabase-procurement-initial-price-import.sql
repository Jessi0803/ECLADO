-- Initial ECLADO procurement catalog import.
-- Source: ECLADO_產品價格對照表.docx (47 rows, USD).
-- Requires supabase-procurement-catalog.sql.
--
-- Safe to rerun:
--   * supplier items are upserted by supplier + supplier SKU;
--   * variant links are upserted by supplier item + product variant;
--   * an initial price is inserted only when the item has no price history.

begin;

create temp table procurement_seed (
  supplier_sku text primary key,
  name_en text not null,
  name_zh text,
  specification text,
  unit_cost numeric(14, 4) not null,
  product_variant_id bigint
) on commit drop;

insert into procurement_seed (
  supplier_sku,
  name_en,
  name_zh,
  specification,
  unit_cost,
  product_variant_id
) values
  ('E-2', 'Purifying Cleanser', '純淨潔顏露', '500ml', 7.78, 26),
  ('E-95', 'Enhancer Mild Cleanser', '溫和增效潔面乳', '500ml', 8.52, 37),
  ('E95A', 'Enhancer Mild Cleanser', '溫和增效潔面乳', '200ml', 5.86, 38),
  ('E-9', 'Enzyme Deep Cleanser Pure Powder', '酵素潔顏粉', '100g', 8.52, 42),
  ('E-96A', 'Oxygen Bubble Pack', '氧氣泡泡', '120g', 8.52, 25),
  ('E-2Q', 'Perfect Cleansing Smoothie Balm', '完美潔面卸妝膏', '200ml', 10.66, 14),
  ('E-15Z', 'PHA Soft Peel 15', 'PHA溫和煥膚', '120g', 4.80, 49),
  ('73568', 'Exo Clinica Toner', '精萃爽膚水', '500ml', 6.52, 40),
  ('73541', 'Exo Clinica Gel', '精萃凝膠', '300ml', 5.68, 41),
  ('239', 'Exo Clinica UV Suncream', '精萃防曬霜', '50g', 3.83, 39),
  ('E-15P', 'Rejuven Fiber & Ampoule System', '棉花水光套組', '(1g + 10ml) x 6', 25.57, 33),
  ('F-63', 'VONO Prime Peel', 'VONO煥膚組', '(5ml + 6ml) x 6', 21.85, 50),
  ('E-167A-1', 'C.P 50 Ampoule', 'C.P50安瓶組', '5ml × 10 支', 15.98, 46),
  ('73580', 'AC Jet Ampoule', 'ＡＣ痘痘安瓶', '5ml × 5支', 50.00, 45),
  ('73540-1', 'L-Contour Ampoule', 'Ｌ － 輪廓安瓶', '10ml × 5支', 49.00, 48),
  ('E-17-1', 'Rescuer Multi Vitamin Ampoule', '急救安瓶-維他命美白', '3.5ml × 10支', 10.62, 22),
  ('E-17B', 'Rescuer Cica Pore Ampoule', '急救安瓶-積雪草毛孔', '3.5ml × 10支', 10.62, 23),
  ('E-18-1', 'Rescuer Filagen Ampoule', '急救安瓶-胜肽再生', '3.5ml × 10支', 10.62, 21),
  ('E-19B', 'Rescuer Hydra Complex Ampoule', '急救安瓶-水合複合', '3.5ml × 10支', 10.62, 20),
  ('E-162', 'Cell Phyto Anti Wrinkle Eye Cream', '記憶抗皺眼霜', '30g', 7.06, 28),
  ('E-161', 'Cell Magic Skin Lotion', '記憶多肽化妝水', '140ml', 8.52, null),
  ('E-160', 'Cell Magic Skin Lotion', '記憶多肽化妝水', '500ml', 13.32, 56),
  ('E-162F', 'Cell Phyto Anti Wrinkle Serum', '記憶多肽精華', '50ml', 9.59, 27),
  ('E-165', 'Cell Memory Cream', '記憶修護霜', '50g', 8.52, 29),
  ('E173A', 'Respiration Toner', '呼吸爽膚水', '150ml', 7.99, 53),
  ('E-172', 'Respiration Ampoule', '呼吸安瓶', '30ml', 9.06, 52),
  ('E-171', 'Respiration Serum', '呼吸精華液', '100g', 12.79, 55),
  ('E-174', 'Respiration Snow Cream', '呼吸雪霜', '100g', 9.06, 54),
  ('E180-C', 'A.C Control Ampoule F', '控油修護安瓶', '35ml', 7.99, 30),
  ('F-170C', 'A.C Pimpeel Cream', '淨痘修護霜', '50g', 8.52, 31),
  ('E180-E', 'A.C Centella Mask', '積雪草泥膜', '200g', 6.61, 43),
  ('E-4', 'Rebalancing Toner', '平衡爽膚水', '500ml', 8.10, 12),
  ('E-3', 'Rebalancing Toner', '平衡爽膚水', '1000ml', 12.25, 13),
  ('E-93B', 'Soothing Mask', '舒緩凍膜', '800g', 12.25, 34),
  ('E-56B', 'Moisture Supplement Cream', '保濕補水霜', '50g', 7.99, 19),
  ('F-30D', 'Ultra Gold Velvet Mask', '黃金天鵝絨⾯膜', '10片／盒', 15.46, 35),
  ('F-30C', 'Ultra Pearl Velvet Mask', '極致珍珠緞面膜', '10片／盒', 14.40, 36),
  ('AB-1', 'Alphabiome Brightening Mask', '乳酸菌亮白⾯膜', '10片／盒', 5.20, 15),
  ('E410', 'Melaser Radiance Cream', '光采素顏霜', '70g', 4.69, 17),
  ('E-64C', 'Whitening Enhancer Sun Blemish Balm', '亮顏防曬BB霜', '50g', 7.99, 18),
  ('229', 'Azulene Cure Solution Ampoule', '洋甘菊舒緩安瓶', '30ml', 4.00, 24),
  ('73711', 'Exo Filagen Cream', '蛋白胜肽霜', '100g', 4.84, 32),
  ('NM-1', 'Royal Milk Protein Facial Mask', '皇家牛奶蛋白面膜', '70g', 4.36, null),
  ('F-58C', 'Gold Patch', '金箔片', '50片／盒', 101.24, 16),
  ('73720', 'ECLADO Celvix Pro', 'Celvix Pro', 'Celvix Pro 贈蛋白胜肽霜', 109.86, 47),
  ('73540', 'ECLADO Celvix Airjet', 'Celvix Airjet', '1台', 978.00, null),
  ('E-65B', 'UV Oil Free Sun Cream', '無油防曬霜', '70g', 5.86, null);

with target_supplier as (
  select id
  from public.suppliers
  where lower(code) = lower('ECLADO_KR')
)
insert into public.supplier_items (
  supplier_id,
  supplier_sku,
  name_en,
  name_zh,
  specification,
  active
)
select
  target_supplier.id,
  seed.supplier_sku,
  seed.name_en,
  seed.name_zh,
  seed.specification,
  true
from procurement_seed seed
cross join target_supplier
on conflict (supplier_id, lower(supplier_sku)) do update
set
  name_en = excluded.name_en,
  name_zh = excluded.name_zh,
  specification = excluded.specification,
  active = true;

with target_supplier as (
  select id
  from public.suppliers
  where lower(code) = lower('ECLADO_KR')
)
insert into public.supplier_item_variant_links (
  supplier_item_id,
  product_variant_id,
  conversion_quantity,
  is_primary
)
select
  item.id,
  seed.product_variant_id,
  1,
  true
from procurement_seed seed
cross join target_supplier
join public.supplier_items item
  on item.supplier_id = target_supplier.id
 and lower(item.supplier_sku) = lower(seed.supplier_sku)
join public.product_variants variant
  on variant.id = seed.product_variant_id
where seed.product_variant_id is not null
on conflict (supplier_item_id, product_variant_id) do update
set
  conversion_quantity = excluded.conversion_quantity,
  is_primary = excluded.is_primary;

with target_supplier as (
  select id
  from public.suppliers
  where lower(code) = lower('ECLADO_KR')
)
insert into public.supplier_item_prices (
  supplier_item_id,
  currency,
  unit_cost,
  effective_from,
  note
)
select
  item.id,
  'USD',
  seed.unit_cost,
  now(),
  'Initial import from ECLADO_產品價格對照表.docx'
from procurement_seed seed
cross join target_supplier
join public.supplier_items item
  on item.supplier_id = target_supplier.id
 and lower(item.supplier_sku) = lower(seed.supplier_sku)
where not exists (
  select 1
  from public.supplier_item_prices existing_price
  where existing_price.supplier_item_id = item.id
);

commit;

-- Verification summary returned by the SQL Editor.
select jsonb_build_object(
  'supplier_items', (
    select count(*)
    from public.supplier_items item
    join public.suppliers supplier on supplier.id = item.supplier_id
    where lower(supplier.code) = lower('ECLADO_KR')
  ),
  'price_versions', (
    select count(*)
    from public.supplier_item_prices price
    join public.supplier_items item on item.id = price.supplier_item_id
    join public.suppliers supplier on supplier.id = item.supplier_id
    where lower(supplier.code) = lower('ECLADO_KR')
  ),
  'variant_links', (
    select count(*)
    from public.supplier_item_variant_links link
    join public.supplier_items item on item.id = link.supplier_item_id
    join public.suppliers supplier on supplier.id = item.supplier_id
    where lower(supplier.code) = lower('ECLADO_KR')
  ),
  'unlinked_items', (
    select jsonb_agg(
      jsonb_build_object(
        'supplier_sku', item.supplier_sku,
        'name_en', item.name_en,
        'name_zh', item.name_zh,
        'specification', item.specification
      )
      order by item.supplier_sku
    )
    from public.supplier_items item
    join public.suppliers supplier on supplier.id = item.supplier_id
    left join public.supplier_item_variant_links link
      on link.supplier_item_id = item.id
    where lower(supplier.code) = lower('ECLADO_KR')
      and link.supplier_item_id is null
  )
) as procurement_import_verification;
