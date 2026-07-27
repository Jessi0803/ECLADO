-- ECLADO product category migration
-- Run once after deploying the matching frontend/admin category update.

update public.products
set category = case
  when is_pro_only is true
    or category ~ '(院線|課程|儀器|試用包)'
    then '院線課程儀器（含試用包）'
  when category ~ '(清潔|卸妝)'
    then '清潔卸妝'
  when category ~ '化妝水'
    then '化妝水'
  when category ~ '(安瓶|精華)'
    then '安瓶精華'
  when category ~ '(乳霜|面霜|眼霜)'
    then '乳霜'
  when category ~ '面膜'
    then '面膜'
  when category ~ '(防曬|底妝)'
    then '防曬底妝'
  when category = '其他'
    then '其他'
  else category
end
where category is not null;

-- Review the result before making further manual category changes.
select category, count(*) as product_count
from public.products
group by category
order by category;
