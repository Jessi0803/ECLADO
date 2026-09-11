-- Product series mapping from ECLADO price list 2026.09.
-- Products not present in the price list intentionally keep their current series.

begin;

with series_map(name_zh, series) as (
  values
    ('溫和增效潔面乳', '清潔'),
    ('酵素潔顏粉', '清潔'),
    ('純淨潔顏露', '清潔'),
    ('氧氣泡泡', '清潔'),
    ('完美潔面卸妝膏', '清潔'),
    ('PHA溫和煥膚', '清潔'),
    ('AHA 角質霜', '清潔'),
    ('精萃爽膚水', '微囊精萃'),
    ('精萃凝膠', '微囊精萃'),
    ('精萃防曬乳', '微囊精萃'),
    ('棉花水光管理', '院線組合'),
    ('VONO 煥膚組', '院線組合'),
    ('C.P 50 安瓶組', '院線組合'),
    ('金箔貼片', '院線組合'),
    ('L－輪廓安瓶', 'Air jet'),
    ('AC 痘痘安瓶', 'Air jet'),
    ('維他命美白安瓶', '急救安瓶'),
    ('積雪草毛孔安瓶', '急救安瓶'),
    ('胜肽再生安瓶', '急救安瓶'),
    ('水合複合安瓶', '急救安瓶'),
    ('黃金天鵝絨面膜', '面膜'),
    ('極致珍珠緞面膜', '面膜'),
    ('乳酸菌亮白面膜', '面膜'),
    ('光采素顏霜', '面膜'),
    ('平衡爽膚水', 'Deep'),
    ('保濕補水霜', 'Deep'),
    ('舒緩凍膜', 'Deep'),
    ('爆水按摩霜', 'Deep'),
    ('呼吸爽膚水', 'SOS'),
    ('呼吸精華液', 'SOS'),
    ('呼吸安瓶', 'SOS'),
    ('呼吸雪霜', 'SOS'),
    ('記憶奇蹟活膚乳', 'Cell'),
    ('記憶多肽精華', 'Cell'),
    ('記憶抗皺眼霜', 'Cell'),
    ('記憶修護霜', 'Cell'),
    ('積雪草泥膜', 'AC'),
    ('控油修護安瓶', 'AC'),
    ('淨痘修護霜', 'AC'),
    ('亮顏防曬BB霜', 'Extra'),
    ('無油防曬霜', 'Extra'),
    ('洋甘菊舒緩安瓶', 'Extra'),
    ('蛋白胜肽霜', 'Extra'),
    ('黃金檀香刮痧板', 'Special'),
    ('多功能護理儀', 'Special'),
    ('圓角矽膠刷', 'Special'),
    ('慕斯空瓶', 'Special'),
    ('溫和增效潔面乳（試用包）', '試用包'),
    ('精萃防曬（試用包）', '試用包'),
    ('控油修護安瓶（試用包）', '試用包'),
    ('淨痘修護霜（試用包）', '試用包'),
    ('積雪草泥膜（試用包）', '試用包'),
    ('光采亮白霜（試用包）', '試用包'),
    ('呼吸安瓶（試用包）', '試用包'),
    ('呼吸精華（試用包）', '試用包'),
    ('記憶奇蹟活膚乳（試用包）', '試用包'),
    ('記憶修護眼霜（試用包）', '試用包'),
    ('記憶多肽精華（試用包）', '試用包'),
    ('記憶修護霜（試用包）', '試用包'),
    ('無油防曬霜（試用包）', '試用包')
)
update public.products as product
set series = series_map.series,
    updated_at = now()
from series_map
where product.name_zh = series_map.name_zh
  and product.series is distinct from series_map.series;

commit;

select series, count(*) as product_count
from public.products
group by series
order by series nulls last;
