begin transaction read only;
select jsonb_build_object(
  'student_prices_off',not (select enabled from public.student_pricing_feature_settings where singleton),
  'public_queries_authenticated',has_function_privilege('authenticated','public.get_my_instructor_reward_report(integer,integer,integer)','EXECUTE')
    and has_function_privilege('authenticated','public.get_admin_instructor_reward_report(uuid,integer,integer,integer)','EXECUTE')
    and has_function_privilege('authenticated','public.get_admin_instructor_reward_accounts(integer,integer)','EXECUTE'),
  'anon_denied',not has_function_privilege('anon','public.get_my_instructor_reward_report(integer,integer,integer)','EXECUTE')
    and not has_function_privilege('anon','public.get_admin_instructor_reward_report(uuid,integer,integer,integer)','EXECUTE')
    and not has_function_privilege('anon','public.get_admin_instructor_reward_accounts(integer,integer)','EXECUTE'),
  'helpers_private',not has_function_privilege('authenticated','public.instructor_reward_report_internal(uuid,integer,integer,integer)','EXECUTE')
    and not has_function_privilege('service_role','public.instructor_reward_report_internal(uuid,integer,integer,integer)','EXECUTE')
    and not has_function_privilege('authenticated','public.assert_instructor_reward_read_admin()','EXECUTE'),
  'tables_still_private',not has_table_privilege('authenticated','public.student_reward_snapshots','SELECT')
    and not has_table_privilege('authenticated','public.instructor_reward_accounts','SELECT')
    and not has_table_privilege('authenticated','public.instructor_reward_ledger','SELECT')
) verification;
rollback;
