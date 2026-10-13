begin transaction read only;
select jsonb_build_object(
 'student_prices_off',(select not enabled from public.student_pricing_feature_settings where singleton),
 'private_tables',not exists(select 1 from unnest(array['instructor_reward_notification_outbox','instructor_reward_notification_attempts','instructor_reward_reconciliation_runs','instructor_reward_reconciliation_findings']) t
 cross join unnest(array['anon','authenticated','service_role']) r where has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
 'rls_enabled',not exists(select 1 from pg_class where oid in('public.instructor_reward_notification_outbox'::regclass,'public.instructor_reward_notification_attempts'::regclass,'public.instructor_reward_reconciliation_runs'::regclass,'public.instructor_reward_reconciliation_findings'::regclass) and not relrowsecurity),
 'no_policies',not exists(select 1 from pg_policy where polrelid in('public.instructor_reward_notification_outbox'::regclass,'public.instructor_reward_notification_attempts'::regclass,'public.instructor_reward_reconciliation_runs'::regclass,'public.instructor_reward_reconciliation_findings'::regclass)),
 'worker_acl',has_function_privilege('service_role','public.claim_reward_notifications(integer,text[],text)','EXECUTE') and has_function_privilege('service_role','public.complete_reward_notification(uuid,uuid,text,text)','EXECUTE') and not has_function_privilege('authenticated','public.claim_reward_notifications(integer,text[],text)','EXECUTE') and not has_function_privilege('anon','public.complete_reward_notification(uuid,uuid,text,text)','EXECUTE'),
 'helper_private',not has_function_privilege('service_role','public.reward_financial_checks()','EXECUTE') and not has_function_privilege('authenticated','public.queue_reward_withdrawal_notice()','EXECUTE'),
 'admin_acl',has_function_privilege('authenticated','public.get_admin_reward_notifications(integer)','EXECUTE') and has_function_privilege('authenticated','public.get_admin_reward_reconciliation(integer)','EXECUTE') and not has_function_privilege('service_role','public.get_admin_reward_notifications(integer)','EXECUTE') and not has_function_privilege('anon','public.run_reward_reconciliation(uuid)','EXECUTE'),
 'ledger_consistent',not exists(select 1 from public.reward_financial_checks() where rule not in('payment_unknown','withdrawal_unknown')),
 's1_preserved',not has_function_privilege('authenticated','public.begin_order_payment_retry(text)','EXECUTE') and not has_function_privilege('anon','public.claim_order_payment(text,text)','EXECUTE'),
 'empty_search_path',not exists(select 1 from pg_proc where oid in('public.claim_reward_notifications(integer,text[],text)'::regprocedure,'public.complete_reward_notification(uuid,uuid,text,text)'::regprocedure,'public.run_reward_reconciliation(uuid)'::regprocedure,'public.retry_reward_notification(uuid,uuid,boolean,text)'::regprocedure) and not ('search_path=""'=any(proconfig)))
) verification;
rollback;
