begin transaction read only;
select jsonb_build_object(
 'student_prices_off',(select enabled=false from public.student_pricing_feature_settings where singleton),
 'private_tables',(select bool_and(c.relrowsecurity and not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
   from unnest(array['public.instructor_reward_accounts','public.instructor_reward_order_states','public.instructor_reward_ledger','public.instructor_reward_payment_receipts']) t
   cross join unnest(array['anon','authenticated','service_role']) r join pg_class c on c.oid=t::regclass),
 'bank_service_only',has_function_privilege('service_role','public.record_verified_instructor_reward_payment(text,text,text)','EXECUTE')
   and not has_function_privilege('anon','public.record_verified_instructor_reward_payment(text,text,text)','EXECUTE')
   and not has_function_privilege('authenticated','public.record_verified_instructor_reward_payment(text,text,text)','EXECUTE'),
 'internal_posting_closed',not has_function_privilege('authenticated','public.append_instructor_reward_event(text,text)','EXECUTE')
   and not has_function_privilege('service_role','public.append_instructor_reward_event(text,text)','EXECUTE'),
 'no_orphan_snapshots',not exists(select 1 from public.student_reward_snapshots s left join public.instructor_reward_order_states r on r.order_id=s.order_id where r.order_id is null),
 'account_ledger_agrees',not exists(select 1 from public.instructor_reward_accounts a left join(
   select instructor_id,sum(balance_delta) b,sum(pending_delta) p from public.instructor_reward_ledger group by instructor_id
   ) l on l.instructor_id=a.user_id where a.balance<>coalesce(l.b,0) or a.pending_balance<>coalesce(l.p,0)),
 'ledger_projections_agree',not exists(select 1 from public.instructor_reward_order_states s where
   s.amount is distinct from(select total_reward from public.student_reward_snapshots where order_id=s.order_id)
   or not exists(select 1 from public.instructor_reward_ledger where order_id=s.order_id and event_type='pending')
   or (s.status='credited' and not exists(select 1 from public.instructor_reward_ledger where order_id=s.order_id and event_type='credit'))
   or (s.status='cancelled' and not exists(select 1 from public.instructor_reward_ledger where order_id=s.order_id and event_type='cancel'))
   or (s.status='reversed' and not exists(select 1 from public.instructor_reward_ledger where order_id=s.order_id and event_type='reverse'))),
 'ledger_running_balances_agree',not exists(select 1 from(
   select balance_after,pending_after,sum(balance_delta) over(partition by instructor_id order by id) b,
     sum(pending_delta) over(partition by instructor_id order by id) p from public.instructor_reward_ledger
   ) history where balance_after<>b or pending_after<>p),
 'triggers_enabled',(select count(*)=6 and bool_and(tgenabled='O') from pg_trigger where tgname in(
   'trg_reward_ledger_immutable','trg_reward_receipt_immutable','trg_initialize_reward_order','trg_guard_reward_order','trg_sync_reward_order_status','trg_guard_reward_member_deletion'))
) verification;
rollback;
