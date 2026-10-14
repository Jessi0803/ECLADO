-- TEST ONLY: qqlgqasbmbicnmvnlqbr. Inventory without reading customer fields.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT jsonb_build_object(
 'project_expected','qqlgqasbmbicnmvnlqbr',
 'postgres',version(),
 'read_only',current_setting('transaction_read_only'),
 'tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),
 'functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'),
 'student_feature',(SELECT jsonb_build_object('enabled',enabled,'version',version) FROM public.student_pricing_feature_settings),
 'auth_users',(SELECT count(*) FROM auth.users),
 'profiles',(SELECT count(*) FROM public.profiles),
 'orders',(SELECT count(*) FROM public.orders),
 'products',(SELECT count(*) FROM public.products),
 'snapshots',(SELECT count(*) FROM public.student_reward_snapshots),
 'reward_accounts',(SELECT count(*) FROM public.instructor_reward_accounts),
 'reward_ledger',(SELECT count(*) FROM public.instructor_reward_ledger),
 'withdrawals',(SELECT count(*) FROM public.instructor_reward_withdrawals),
 'outbox',(SELECT count(*) FROM public.instructor_reward_notification_outbox),
 'storage_objects',(SELECT count(*) FROM storage.objects),
 'financial_tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,
 'anon_direct',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
 'authenticated_direct',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) ORDER BY c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
 AND (c.relname='student_reward_snapshots' OR c.relname LIKE 'instructor_reward_%')),
 's1',(SELECT jsonb_agg(jsonb_build_object('signature',signature,
 'anon_denied',NOT has_function_privilege('anon',signature,'EXECUTE'),
 'authenticated_denied',NOT has_function_privilege('authenticated',signature,'EXECUTE'),
 'service_allowed',has_function_privilege('service_role',signature,'EXECUTE')))
 FROM (VALUES('public.begin_order_payment_retry(text)'),('public.claim_order_payment(text,text)')) f(signature)),
 'legacy_product',(SELECT to_jsonb(p) FROM public.products p WHERE id=1239098751)
) payload;
ROLLBACK;
