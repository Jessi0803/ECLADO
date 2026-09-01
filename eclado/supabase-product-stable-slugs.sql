-- Stable storefront product URLs.
-- Existing rows are initialized from the current English product name.
-- Later name edits do not modify slug; new products receive a slug on insert.

create or replace function public.make_product_slug(input_value text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select trim(both '-' from regexp_replace(
    lower(translate(btrim(coalesce(input_value, '')), chr(39) || '’', '')),
    '[^a-z0-9一-龥]+',
    '-',
    'g'
  ));
$function$;

revoke all on function public.make_product_slug(text) from public;
grant execute on function public.make_product_slug(text) to authenticated;

alter table public.products
  add column if not exists slug text;

update public.products
set slug = public.make_product_slug(name)
where nullif(btrim(slug), '') is null;

-- Trial-pack products currently keep a Chinese display name, so their stable
-- storefront paths use the matching full-size product's English name.
update public.products as product
set slug = trial_pack.slug
from (
  values
    (144::bigint, 'cell-phyto-anti-wrinkle-serum-sample'),
    (145::bigint, 'cell-memory-cream-sample'),
    (146::bigint, 'enhancer-mild-cleanser-sample'),
    (147::bigint, 'exo-clinica-uv-suncream-sample'),
    (148::bigint, 'a-c-control-ampoule-f-sample')
) as trial_pack(id, slug)
where product.id = trial_pack.id;

do $$
begin
  if exists (
    select 1
    from public.products
    group by lower(slug)
    having count(*) > 1
  ) then
    raise exception 'Duplicate product slugs exist; resolve them before adding the unique index';
  end if;
end;
$$;

alter table public.products
  alter column slug set not null;

alter table public.products
  drop constraint if exists products_slug_not_blank;

alter table public.products
  add constraint products_slug_not_blank check (btrim(slug) <> '');

create unique index if not exists products_slug_unique
  on public.products (lower(slug));

create or replace function public.set_product_slug_on_insert()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.slug := public.make_product_slug(coalesce(nullif(btrim(new.slug), ''), new.name));
  elsif nullif(btrim(new.slug), '') is null then
    new.slug := old.slug;
  else
    new.slug := public.make_product_slug(new.slug);
  end if;

  if nullif(new.slug, '') is null then
    raise exception 'Product English name must produce a non-empty slug'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

revoke all on function public.set_product_slug_on_insert() from public;

drop trigger if exists trg_set_product_slug_on_insert on public.products;
create trigger trg_set_product_slug_on_insert
  before insert or update of slug on public.products
  for each row execute function public.set_product_slug_on_insert();

comment on column public.products.slug is
  'Immutable-by-default storefront URL slug. Initialized from the English name and retained when names change.';

select id, name_zh, name, slug
from public.products
order by id;
