-- Product-level professional tier multiplier control.
-- Gold Patch uses its configured professional price for every professional role.

alter table public.products
  add column if not exists apply_tier_multiplier boolean not null default true;

update public.products
set apply_tier_multiplier = false,
    updated_at = now()
where name_zh in ('金箔片', '金箔貼片')
   or slug = 'gold-patch';

comment on column public.products.apply_tier_multiplier is
  'When false, pro/instructor/distributor all pay the configured professional price without role multipliers.';
