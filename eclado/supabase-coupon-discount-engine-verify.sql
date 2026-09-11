-- Batch 3 read-only verification. Expected final column: batch_3_all_checks_passed = true.
with checks as (
  select
    to_regprocedure('public.quote_order_pricing(jsonb,text,text,text)') is not null as coupon_quote_exists,
    to_regprocedure('public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text)') is not null as coupon_order_exists,
    to_regprocedure('public.save_discount_promotion(jsonb)') is not null as promotion_save_exists,
    to_regprocedure('public.save_coupon_campaign(jsonb)') is not null as coupon_save_exists,
    to_regprocedure('public.promotion_item_matches_scope(uuid,jsonb,text)') is not null as scope_matcher_exists,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'promotions'
        and column_name = 'threshold_type'
    ) as threshold_type_exists,
    exists (
      select 1 from pg_trigger
      where tgrelid = 'public.orders'::regclass
        and tgname = 'trg_sync_coupon_redemption_from_order_status'
        and not tgisinternal
    ) as redemption_trigger_exists,
    has_function_privilege('anon', 'public.quote_order_pricing(jsonb,text,text,text)', 'EXECUTE') as anon_can_quote,
    not has_table_privilege('anon', 'public.coupon_campaigns', 'SELECT') as coupon_table_private,
    pg_get_functiondef('public.quote_order_pricing(jsonb,text,text,text)'::regprocedure)
      ilike '%benefit_type in (''percentage_discount'', ''fixed_discount'')%' as discounts_enabled,
    pg_get_functiondef('public.quote_order_pricing(jsonb,text,text,text)'::regprocedure)
      not ilike '%benefit_type in (''amount_gift'', ''quantity_gift'')%' as gifts_still_disabled,
    pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure)
      ilike '%threshold_type = ''quantity''%' as quantity_discount_threshold_exists,
    pg_get_functiondef('public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text)'::regprocedure)
      ilike '%pg_advisory_xact_lock%' as quota_lock_exists,
    pg_get_functiondef('public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text)'::regprocedure)
      ilike '%insert into public.coupon_redemptions%' as redemption_reservation_exists,
    pg_get_functiondef('public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text)'::regprocedure)
      ilike '%insert into public.order_adjustments%' as adjustment_snapshot_exists
)
select *,
  coupon_quote_exists and coupon_order_exists and promotion_save_exists
  and coupon_save_exists and scope_matcher_exists and threshold_type_exists and redemption_trigger_exists
  and anon_can_quote and coupon_table_private and discounts_enabled
  and gifts_still_disabled and quantity_discount_threshold_exists and quota_lock_exists and redemption_reservation_exists
  and adjustment_snapshot_exists as batch_3_all_checks_passed
from checks;
