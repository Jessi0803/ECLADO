-- Read-only verification after supabase-member-pricing.sql.
select jsonb_build_object(
  'settings_read_rpc', to_regprocedure('public.get_admin_member_pricing()') is not null,
  'settings_save_rpc', to_regprocedure('public.save_member_pricing(jsonb,jsonb)') is not null,
  'pricing_helper', to_regprocedure('public.resolve_product_price_multiplier(public.products,text,numeric)') is not null,
  'catalog_wrapper', to_regprocedure('public.get_storefront_catalog_before_member_pricing()') is not null,
  'admin_permission', exists (select 1 from public.backoffice_role_permissions where role='admin' and permission='member_pricing.manage'),
  'editor_cannot_manage_globals', not exists (select 1 from public.backoffice_role_permissions where role='catalog_editor' and permission='member_pricing.manage'),
  'raw_quote_not_public', not has_function_privilege('authenticated','public.quote_order_pricing_internal_20260916(jsonb,text)','execute'),
  'tier_audit_trigger', exists (select 1 from pg_trigger where tgrelid='public.membership_tiers'::regclass and tgname='trg_membership_tiers_pricing_audit' and not tgisinternal)
) as verification;

select role, professional_price_multiplier, professional_price_multiplier * 10 as fold
from public.membership_tiers where role in ('instructor','distributor','staff') order by role;

-- Legacy no-multiplier products should start at 10 folds for all three roles.
-- Later legitimate edits may change these values; this is not a perpetual constraint.
select id, name_zh, publication_status,
  instructor_price_multiplier * 10 as instructor_fold,
  distributor_price_multiplier * 10 as distributor_fold,
  staff_price_multiplier * 10 as staff_fold
from public.products where apply_tier_multiplier is false order by id;
