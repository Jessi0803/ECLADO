-- Read-only verification for supabase-promotions-coupons-foundation.sql.
-- Every query should return the expected value described in its alias.

select count(*) = 6 as expected_six_foundation_tables
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'promotion_scopes',
    'coupon_campaigns',
    'coupon_promotions',
    'coupon_redemptions',
    'promotion_gift_reservations',
    'order_adjustments'
  );

select count(*) = 11 as expected_eleven_promotion_columns
from information_schema.columns
where table_schema = 'public'
  and table_name = 'promotions'
  and column_name in (
    'benefit_type',
    'activation_type',
    'threshold_value',
    'threshold_type',
    'threshold_basis',
    'gift_variant_id',
    'gift_quantity',
    'repeat_mode',
    'exclusive_group',
    'priority',
    'archived_at'
  );

select count(*) = 3 as expected_three_order_coupon_columns
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name in ('coupon_campaign_id', 'coupon_name', 'coupon_code_mask');

select count(*) = 3 as expected_three_allocation_columns
from information_schema.columns
where table_schema = 'public'
  and table_name = 'order_inventory_allocations'
  and column_name in ('line_type', 'promotion_id', 'coupon_campaign_id');

select pg_get_constraintdef(oid) ilike '%gift_only%' as product_status_accepts_gift_only
from pg_constraint
where conrelid = 'public.products'::regclass
  and conname = 'products_publication_status_check';

select table_name, row_security_enabled
from (
  select c.relname as table_name, c.relrowsecurity as row_security_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'promotion_scopes',
      'coupon_campaigns',
      'coupon_promotions',
      'coupon_redemptions',
      'promotion_gift_reservations',
      'order_adjustments'
    )
) foundation_rls
order by table_name;

select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'promotion_scopes',
    'coupon_campaigns',
    'coupon_promotions',
    'coupon_redemptions',
    'promotion_gift_reservations',
    'order_adjustments'
  )
order by tablename, policyname;

-- Batch 1 must not alter existing promotion or order data.
select
  count(*) as existing_promotions,
  count(*) filter (where benefit_type = 'legacy_discount') as legacy_promotions,
  count(*) filter (where activation_type = 'automatic') as automatic_promotions
from public.promotions;

select
  (select count(*) from public.coupon_campaigns) as coupon_campaigns_should_be_zero,
  (select count(*) from public.coupon_redemptions) as coupon_redemptions_should_be_zero,
  (select count(*) from public.promotion_gift_reservations) as gift_reservations_should_be_zero,
  (select count(*) from public.order_adjustments) as order_adjustments_should_be_zero;

-- Convenience summary: running the entire file ends with one definitive result.
select (
  (select count(*) = 6
   from information_schema.tables
   where table_schema = 'public'
     and table_name in (
       'promotion_scopes',
       'coupon_campaigns',
       'coupon_promotions',
       'coupon_redemptions',
       'promotion_gift_reservations',
       'order_adjustments'
     ))
  and (select count(*) = 11
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'promotions'
         and column_name in (
           'benefit_type',
           'activation_type',
          'threshold_value',
          'threshold_type',
          'threshold_basis',
           'gift_variant_id',
           'gift_quantity',
           'repeat_mode',
           'exclusive_group',
           'priority',
           'archived_at'
         ))
  and (select count(*) = 3
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'orders'
         and column_name in ('coupon_campaign_id', 'coupon_name', 'coupon_code_mask'))
  and (select count(*) = 3
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'order_inventory_allocations'
         and column_name in ('line_type', 'promotion_id', 'coupon_campaign_id'))
  and (select pg_get_constraintdef(oid) ilike '%gift_only%'
       from pg_constraint
       where conrelid = 'public.products'::regclass
         and conname = 'products_publication_status_check')
  and (select count(*) = 6
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relrowsecurity
         and c.relname in (
           'promotion_scopes',
           'coupon_campaigns',
           'coupon_promotions',
           'coupon_redemptions',
           'promotion_gift_reservations',
           'order_adjustments'
         ))
  and (select count(*) = 6
       from pg_policies
       where schemaname = 'public'
         and policyname in (
           'promotion_scopes_manage',
           'coupon_campaigns_manage',
           'coupon_promotions_manage',
           'coupon_redemptions_select_orders',
           'promotion_gift_reservations_select_orders',
           'order_adjustments_select_orders'
         ))
  and (select count(*) = count(*) filter (where benefit_type = 'legacy_discount')
                and count(*) = count(*) filter (where activation_type = 'automatic')
       from public.promotions)
  and (select count(*) = 0 from public.coupon_campaigns)
  and (select count(*) = 0 from public.coupon_redemptions)
  and (select count(*) = 0 from public.promotion_gift_reservations)
  and (select count(*) = 0 from public.order_adjustments)
) as batch_1_all_checks_passed;
