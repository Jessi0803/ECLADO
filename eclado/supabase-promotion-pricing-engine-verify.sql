-- Read-only verification for supabase-promotion-pricing-engine.sql.

with function_checks as (
  select
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'products'
        and column_name = 'apply_tier_multiplier'
    ) as tier_override_exists,
    to_regprocedure('public.quote_order_pricing(jsonb,text)') is not null as quote_exists,
    pg_get_functiondef('public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text)'::regprocedure)
      ilike '%quote_result := public.quote_order_pricing(p_items, normalized_fulfillment_method)%'
      as order_uses_quote,
    pg_get_functiondef('public.quote_order_pricing(jsonb,text)'::regprocedure)
      ilike '%promotion.benefit_type = ''legacy_discount''%'
      as legacy_only,
    pg_get_functiondef('public.quote_order_pricing(jsonb,text)'::regprocedure)
      ilike '%promotion.activation_type = ''automatic''%'
      as automatic_only,
    pg_get_functiondef('public.quote_order_pricing(jsonb,text)'::regprocedure)
      ilike '%publication_status in (''active'', ''event_only'')%'
      as gift_only_rejected,
    not exists (
      select 1
      from pg_proc function_acl
      cross join lateral aclexplode(
        coalesce(function_acl.proacl, acldefault('f', function_acl.proowner))
      ) permission
      where function_acl.oid = 'public.quote_order_pricing(jsonb,text)'::regprocedure
        and permission.grantee = 0
        and permission.privilege_type = 'EXECUTE'
    ) as public_execute_revoked,
    has_function_privilege('anon', 'public.quote_order_pricing(jsonb,text)', 'EXECUTE')
      as anon_can_quote,
    has_function_privilege('authenticated', 'public.quote_order_pricing(jsonb,text)', 'EXECUTE')
      as authenticated_can_quote
), sample as (
  select
    product.id as product_id,
    variant.id as variant_id
  from public.products product
  join public.product_variants variant on variant.product_id = product.id
  where product.publication_status = 'active'
    and product.is_pro_only = false
    and variant.active = true
  order by product.id, variant.is_default desc, variant.sort_order, variant.id
  limit 1
), quote as (
  select public.quote_order_pricing(
    jsonb_build_array(jsonb_build_object(
      'product_id', sample.product_id,
      'variant_id', sample.variant_id,
      'qty', 1
    )),
    'delivery'
  ) as value
  from sample
), quote_checks as (
  select
    count(*) = 1 as sample_quote_exists,
    bool_and((value ->> 'member_role') = 'consumer') as anonymous_is_consumer,
    bool_and(jsonb_array_length(value -> 'items') = 1) as one_item_returned,
    bool_and((value ->> 'subtotal')::numeric >= 0) as subtotal_valid,
    bool_and((value ->> 'discount')::numeric >= 0) as discount_valid,
    bool_and(
      (value ->> 'total')::numeric
      = (value ->> 'subtotal')::numeric
        - (value ->> 'discount')::numeric
        + (value ->> 'shipping')::numeric
    ) as total_equation_valid,
    bool_and(value -> 'pricing_snapshot' ->> 'engine' = 'authoritative_quote_v1')
      as snapshot_engine_valid
  from quote
)
select
  function_checks.tier_override_exists
  and function_checks.quote_exists
  and function_checks.order_uses_quote
  and function_checks.legacy_only
  and function_checks.automatic_only
  and function_checks.gift_only_rejected
  and function_checks.public_execute_revoked
  and function_checks.anon_can_quote
  and function_checks.authenticated_can_quote
  and quote_checks.sample_quote_exists
  and quote_checks.anonymous_is_consumer
  and quote_checks.one_item_returned
  and quote_checks.subtotal_valid
  and quote_checks.discount_valid
  and quote_checks.total_equation_valid
  and quote_checks.snapshot_engine_valid
    as batch_2_all_checks_passed
from function_checks
cross join quote_checks;
