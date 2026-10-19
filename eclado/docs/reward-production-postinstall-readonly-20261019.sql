begin transaction read only;
set local statement_timeout='15s';
with pricing(signature,hash) as (values ('automatic_promotion_allows_identity(uuid,text,uuid)','b19c66eb496348b953f0c76e2b80ad86'),('coupon_campaign_allows_identity(uuid,text)','e25009666f907c9d5a5b0e875b1486e0'),('promotion_item_matches_scope(uuid,jsonb,text)','4313e15c56dae806f4a7b07d578192a1'),('quote_order_pricing_internal_20260916(jsonb,text)','0fc1ef1d1b3c98dfdc6580a2d93a4363'),('resolve_product_price_multiplier(products,text,numeric)','6c8dc63e1045e5660330201e1040d203'),('save_discount_promotion(jsonb)','32abb015a300e5783b804e1ffd7c529d'),('save_discount_promotion_before_audience_20261017(jsonb)','18ca7aeee4a7633925dbabb86b887a7b')), financial_tables as (select unnest(array['instructor_reward_accounts','instructor_reward_bank_profiles','instructor_reward_ledger','instructor_reward_notification_attempts','instructor_reward_notification_outbox','instructor_reward_order_states','instructor_reward_payment_exceptions','instructor_reward_payment_receipts','instructor_reward_reconciliation_findings','instructor_reward_reconciliation_runs','instructor_reward_reservations','instructor_reward_withdrawal_events','instructor_reward_withdrawal_exports','instructor_reward_withdrawals','student_reward_snapshots']) name)
select jsonb_build_object(
 'student_prices_off',(select not enabled and version=0 from public.student_pricing_feature_settings where singleton),
 'all_reward_tables_installed',(select count(*)=15 from financial_tables where to_regclass('public.'||name) is not null),
 'reward_tables_rls',not exists(select 1 from financial_tables t join pg_class c on c.oid=to_regclass('public.'||t.name) where not c.relrowsecurity),
 'no_direct_financial_access',not exists(select 1 from financial_tables t cross join unnest(array['anon','authenticated','service_role']) r where has_table_privilege(r,'public.'||t.name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
 'existing_activity_pricing_unchanged',not exists(select 1 from pricing where md5(pg_get_functiondef(to_regprocedure('public.'||signature))) is distinct from hash),
 'no_financial_rows',(select count(*) from public.student_reward_snapshots)+(select count(*) from public.instructor_reward_ledger)+(select count(*) from public.instructor_reward_accounts)+(select count(*) from public.instructor_reward_withdrawals)=0,
 'no_notifications_queued',not exists(select 1 from public.instructor_reward_notification_outbox),
 'no_bank_profiles',not exists(select 1 from public.instructor_reward_bank_profiles),
 'no_financial_findings',not exists(select 1 from public.reward_financial_checks()),
 'old_orders_reward_zero',not exists(select 1 from public.orders where reward_credit_amount<>0),
 'pending_order_count',(select count(*) from public.orders where status in('unpaid','awaiting_confirm')),
 'reward_table_count',15,
 'partial_quote_installed',to_regprocedure('public.quote_my_reward_withdrawal(bigint)') is not null
) as verification;
rollback;
