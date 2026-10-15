begin read only;
select jsonb_build_object(
 'audit_rls',(select relrowsecurity from pg_class where oid='public.instructor_reward_withdrawal_exports'::regclass),
 'audit_no_direct_access',not has_table_privilege('authenticated','public.instructor_reward_withdrawal_exports','select') and not has_table_privilege('service_role','public.instructor_reward_withdrawal_exports','select'),
 'queue_authenticated',has_function_privilege('authenticated','public.get_admin_reward_withdrawal_queue(integer,date,text,text)','execute'),
 'queue_no_anon',not has_function_privilege('anon','public.get_admin_reward_withdrawal_queue(integer,date,text,text)','execute'),
 'export_service_only',has_function_privilege('service_role','public.export_reward_withdrawal_batch(uuid,date)','execute') and not has_function_privilege('authenticated','public.export_reward_withdrawal_batch(uuid,date)','execute') and not has_function_privilege('anon','public.export_reward_withdrawal_batch(uuid,date)','execute'),
 'immutable_audit',exists(select 1 from pg_trigger where tgrelid='public.instructor_reward_withdrawal_exports'::regclass and tgname='reward_withdrawal_exports_immutable' and tgenabled='O'),
 'empty_search_path',not exists(select 1 from pg_proc where oid in('public.get_admin_reward_withdrawal_queue(integer,date,text,text)'::regprocedure,'public.export_reward_withdrawal_batch(uuid,date)'::regprocedure) and (not prosecdef or not exists(select 1 from unnest(proconfig) c where c in('search_path=""','search_path='))))
) as verification;
rollback;
