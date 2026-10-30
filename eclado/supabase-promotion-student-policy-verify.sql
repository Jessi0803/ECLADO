-- Read-only post-install assertions; enabled is reported separately, not changed.
select
  (select count(*)=1 from public.promotion_student_policy_settings where singleton and version=1) as settings_present,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='promotions' and column_name='allow_student_price_stacking' and is_nullable='NO') as policy_column_present,
  position('public.student_policy_price_lines' in pg_get_functiondef('public.allocate_automatic_prices(jsonb,text,uuid)'::regprocedure))>0 as allocation_integrated,
  position('student_price_restoration' in pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure))>0 as storefront_signed_total,
  position('student_price_restoration' in pg_get_functiondef('public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean)'::regprocedure))>0 as assisted_signed_total,
  position('public.student_reward_excluded_quantity' in pg_get_functiondef('public.persist_student_reward_snapshot(text,jsonb)'::regprocedure))>0 as reward_integrated,
  not has_function_privilege('authenticated','public.student_policy_price_lines(jsonb,text,uuid)','EXECUTE')
    and not has_function_privilege('service_role','public.solve_student_policy_component(jsonb,jsonb,integer)','EXECUTE') as helpers_private,
  not has_table_privilege('authenticated','public.promotion_student_policy_settings','UPDATE') as switch_private,
  not has_function_privilege('anon','public.save_promotion_student_policy(uuid,boolean,boolean,timestamptz)','EXECUTE')
    and has_function_privilege('authenticated','public.save_promotion_student_policy(uuid,boolean,boolean,timestamptz)','EXECUTE') as editor_acl;
