-- Correct the four newly imported trial-pack English product names.
-- Safe to run more than once; the id and Chinese name must both match.

begin;

with english_names(id, name_zh, name_en) as (
  values
    (145, '記憶修護霜（試用包）', 'Cell Memory Cream (Sample)'),
    (146, '溫和增效潔面乳（試用包）', 'Enhancer Mild Cleanser (Sample)'),
    (147, '精萃防曬（試用包）', 'Exo Clinica UV Suncream (Sample)'),
    (148, '控油修護安瓶（試用包）', 'A.C Control Ampoule F (Sample)')
)
update public.products as product
set name = english_names.name_en,
    updated_at = now()
from english_names
where product.id = english_names.id
  and product.name_zh = english_names.name_zh
  and product.name is distinct from english_names.name_en;

commit;

select id, name_zh, name as name_en, publication_status
from public.products
where id in (145, 146, 147, 148)
order by id;
