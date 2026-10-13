begin transaction read only;
select jsonb_build_object(
 'student_prices_off',(select not enabled from public.student_pricing_feature_settings where singleton),
 'private_tables',not exists(select 1 from unnest(array['instructor_reward_bank_profiles','instructor_reward_bank_calendar_versions','instructor_reward_withdrawals','instructor_reward_withdrawal_events']) t
 cross join unnest(array['anon','authenticated','service_role']) r where has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
 'rls_enabled',not exists(select 1 from pg_class where oid in('public.instructor_reward_bank_profiles'::regclass,'public.instructor_reward_bank_calendar_versions'::regclass,'public.instructor_reward_withdrawals'::regclass,'public.instructor_reward_withdrawal_events'::regclass) and not relrowsecurity),
 'bank_service_only',has_function_privilege('service_role','public.save_reward_bank_profile(uuid,jsonb,jsonb,bigint)','EXECUTE') and not has_function_privilege('authenticated','public.save_reward_bank_profile(uuid,jsonb,jsonb,bigint)','EXECUTE') and not has_function_privilege('anon','public.read_reward_bank_cipher(uuid,uuid)','EXECUTE'),
 'posting_private',not has_function_privilege('authenticated','public.post_reward_withdrawal(uuid,text)','EXECUTE') and not has_function_privilege('service_role','public.post_reward_withdrawal(uuid,text)','EXECUTE'),
 'account_ledger_agrees',not exists(select 1 from public.instructor_reward_accounts a left join(select instructor_id,sum(balance_delta) b,sum(pending_delta) p,sum(reserved_delta) s,sum(withdrawal_reserved_delta) w from public.instructor_reward_ledger group by instructor_id) l on l.instructor_id=a.user_id
 where a.balance<>coalesce(l.b,0) or a.pending_balance<>coalesce(l.p,0) or a.reserved_balance<>coalesce(l.s,0) or a.withdrawal_reserved_balance<>coalesce(l.w,0)),
 'withdrawal_reserve_agrees',not exists(select 1 from public.instructor_reward_accounts a where a.withdrawal_reserved_balance<>coalesce((select sum(amount) from public.instructor_reward_withdrawals w where w.user_id=a.user_id and w.status in('pending','processing','unknown')),0)),
 'ledger_running_agrees',not exists(select 1 from(select balance_after,withdrawal_reserved_after,sum(balance_delta) over(partition by instructor_id order by id) b,sum(withdrawal_reserved_delta) over(partition by instructor_id order by id) w from public.instructor_reward_ledger) l where l.balance_after<>l.b or l.withdrawal_reserved_after<>l.w),
 'sources_explicit',not exists(select 1 from public.instructor_reward_ledger where (order_id is null)=(withdrawal_id is null)),
 's1_closed',not has_function_privilege('authenticated','public.begin_order_payment_retry(text)','EXECUTE') and not has_function_privilege('authenticated','public.claim_order_payment(text,text)','EXECUTE')
) verification;
rollback;
