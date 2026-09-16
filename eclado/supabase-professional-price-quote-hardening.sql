-- Apply after:
--   1. supabase-coupon-member-targeting.sql
--   2. supabase-coupon-discount-engine.sql
--   3. supabase-promotion-gifts-engine.sql
--
-- Existing deployments need this one-time wrapper migration. The canonical
-- pricing sources also omit these fields so a future rebuild remains safe.

begin;

do $$
begin
  if to_regprocedure('public.quote_order_pricing_internal_20260916(jsonb,text)') is not null then
    raise exception 'supabase-professional-price-quote-hardening.sql was already applied';
  end if;
  if to_regprocedure('public.quote_order_pricing(jsonb,text)') is null then
    raise exception 'quote_order_pricing(jsonb,text) must exist before hardening';
  end if;
  if to_regprocedure('public.quote_order_pricing(jsonb,text,text,text)') is null
    or to_regprocedure('public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text)') is null
    or to_regprocedure('public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text)') is null
    or to_regprocedure('public.quote_order_pricing_discount_v2(jsonb,text,text,text)') is null
    or to_regprocedure('public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)') is null
  then
    raise exception 'coupon and gift pricing migrations must be fully applied before hardening';
  end if;

  alter function public.quote_order_pricing(jsonb, text)
    rename to quote_order_pricing_internal_20260916;
end;
$$;

-- ALTER FUNCTION ... RENAME preserves ACLs. Only SECURITY DEFINER wrappers may
-- invoke the raw pricing implementation after this migration.
revoke all on function public.quote_order_pricing_internal_20260916(jsonb, text)
  from public, anon, authenticated;

create or replace function public.sanitize_public_order_quote(p_quote jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  sanitized jsonb := p_quote;
  sanitized_items jsonb;
begin
  if sanitized is null then
    return null;
  end if;

  if jsonb_typeof(sanitized -> 'items') = 'array' then
    select coalesce(
      jsonb_agg(item - 'professional_price' - 'apply_tier_multiplier'),
      '[]'::jsonb
    )
    into sanitized_items
    from jsonb_array_elements(sanitized -> 'items') item;
    sanitized := jsonb_set(sanitized, '{items}', sanitized_items, true);
  end if;

  if jsonb_typeof(sanitized #> '{pricing_snapshot,items}') = 'array' then
    select coalesce(
      jsonb_agg(item - 'professional_price' - 'apply_tier_multiplier'),
      '[]'::jsonb
    )
    into sanitized_items
    from jsonb_array_elements(sanitized #> '{pricing_snapshot,items}') item;
    sanitized := jsonb_set(sanitized, '{pricing_snapshot,items}', sanitized_items, true);
  end if;

  return sanitized;
end;
$$;

revoke all on function public.sanitize_public_order_quote(jsonb)
  from public, anon, authenticated;

create or replace function public.quote_order_pricing(
  p_items jsonb,
  p_fulfillment_method text default 'delivery'
)
returns jsonb
language sql
security definer
set search_path = public, auth, extensions
as $$
  select public.sanitize_public_order_quote(
    public.quote_order_pricing_internal_20260916(p_items, p_fulfillment_method)
  );
$$;

revoke all on function public.quote_order_pricing(jsonb, text) from public;
grant execute on function public.quote_order_pricing(jsonb, text) to anon, authenticated;

-- The gift migration renames a previously public order function. Revoke the
-- inherited ACL so callers cannot bypass the final public quote/order wrappers.
do $$
begin
  if to_regprocedure('public.quote_order_pricing_discount_v2(jsonb,text,text,text)') is not null then
    execute 'revoke all on function public.quote_order_pricing_discount_v2(jsonb,text,text,text) from public, anon, authenticated';
  end if;
  if to_regprocedure('public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)') is not null then
    execute 'revoke all on function public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text) from public, anon, authenticated';
  end if;
end;
$$;

comment on function public.quote_order_pricing(jsonb, text) is
  'Public authoritative quote with raw professional pricing inputs removed from items and pricing snapshots.';
comment on function public.quote_order_pricing_internal_20260916(jsonb, text) is
  'Internal authoritative pricing implementation. Direct client execution is forbidden; use quote_order_pricing wrappers.';

notify pgrst, 'reload schema';

commit;
