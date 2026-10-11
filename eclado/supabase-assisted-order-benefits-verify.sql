-- Read-only installation checks (all values should be true).
select
  to_regprocedure('public.quote_assisted_order(jsonb)') is not null as quote_installed,
  to_regprocedure('public.confirm_assisted_credit_consent(text,text,bigint)') is not null as consent_installed,
  position('assert_assisted_credit_consent' in pg_get_functiondef('public.claim_order_payment(text,text)'::regprocedure))>0 as bank_claim_guard,
  position('assert_assisted_credit_consent' in pg_get_functiondef('public.begin_order_payment_retry(text)'::regprocedure))>0 as bank_retry_guard,
  position('persist_assisted_benefits' in pg_get_functiondef('public.create_assisted_order(uuid,jsonb)'::regprocedure))>0 as reservations_atomic,
  position('allocate_assisted_inventory' in pg_get_functiondef('public.sync_assisted_inventory()'::regprocedure))>0 as separate_gift_allocation,
  position('release_assisted_inventory' in pg_get_functiondef('public.sync_assisted_inventory()'::regprocedure))>0 as separate_gift_release,
  not has_function_privilege('authenticated','public.create_assisted_order_base_v1(uuid,jsonb)','execute') as legacy_creator_private,
  not has_function_privilege('authenticated','public.confirm_assisted_credit_consent(text,text,bigint)','execute') as consent_server_only,
  not has_function_privilege('anon','public.quote_assisted_order(jsonb)','execute') as quote_admin_only;
