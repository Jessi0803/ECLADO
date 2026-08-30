-- ECLADO product series classification.
-- Keeps products.category as the efficacy category and adds one optional series label.

begin;

alter table public.products
  add column if not exists series text;

create index if not exists products_series_active_idx
  on public.products (series, publication_status, active)
  where series is not null;

with series_map(name_zh, series) as (
  values
    ('溫和增效潔面乳', '清潔'),
    ('酵素潔顏粉', '清潔'),
    ('純淨潔顏露', '清潔'),
    ('氧氣泡泡', '清潔'),
    ('完美潔面卸妝膏', '清潔'),
    ('PHA溫和煥膚', '清潔'),
    ('精萃爽膚水', '微囊精萃'),
    ('精萃凝膠', '微囊精萃'),
    ('精萃防曬霜', '微囊精萃'),
    ('棉花水光套組', '院線組合'),
    ('VONO煥膚組', '院線組合'),
    ('C.P50安瓶組', '院線組合'),
    ('金箔片', '院線組合'),
    ('Ｌ － 輪廓安瓶', 'Air jet'),
    ('ＡＣ痘痘安瓶', 'Air jet'),
    ('急救安瓶-維他命美白', '急救安瓶'),
    ('急救安瓶-積雪草毛孔', '急救安瓶'),
    ('急救安瓶-胜肽再生', '急救安瓶'),
    ('急救安瓶-水合複合', '急救安瓶'),
    ('黃金天鵝絨⾯膜', '面膜'),
    ('極致珍珠緞面膜', '面膜'),
    ('乳酸菌亮白⾯膜', '面膜'),
    ('光采素顏霜', '面膜'),
    ('平衡爽膚水', 'Deep'),
    ('舒緩凍膜', 'Deep'),
    ('保濕補水霜', 'Deep'),
    ('亮顏防曬BB霜', 'Extra'),
    ('洋甘菊舒緩安瓶', 'Extra'),
    ('蛋白胜肽霜', 'Extra'),
    ('爆水按摩霜', 'Extra'),
    ('記憶多肽精華', 'Cell'),
    ('記憶抗皺眼霜', 'Cell'),
    ('記憶修護霜', 'Cell'),
    ('記憶多肽化妝水', 'Cell'),
    ('積雪草泥膜', 'AC'),
    ('控油修護安瓶', 'AC'),
    ('淨痘修護霜', 'AC'),
    ('記憶多肽精華試用包', '試用包'),
    ('細胞記憶霜試用包', '試用包'),
    ('溫和增效潔面乳試用包', '試用包'),
    ('精萃防曬乳試用包', '試用包'),
    ('AC控油安瓶試用包', '試用包'),
    ('黃金檀香刮痧板', 'Special'),
    ('呼吸安瓶', '呼吸'),
    ('呼吸爽膚水', '呼吸'),
    ('呼吸雪霜', '呼吸'),
    ('呼吸精華液', '呼吸')
)
update public.products product
set series = series_map.series
from series_map
where product.name_zh = series_map.name_zh;

update public.products
set series = null
where name_zh in ('金流測試商品', 'Celvix Pro', '客訂', '客訂1', '客訂2');

commit;

select series, count(*) as product_count
from public.products
group by series
order by series nulls last;
