begin transaction read only;
select jsonb_build_object(
 'student_prices_off',(select enabled=false from public.student_pricing_feature_settings where singleton),
 'payment_contract',not exists(select 1 from public.orders where payment_amount+shopping_credit_amount+reward_credit_amount<>total
   or reward_credit_amount<0 or (reward_credit_amount>0 and (payment_amount<1 or order_source<>'online'))),
 'private_tables',not has_table_privilege('authenticated','public.instructor_reward_reservations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
   and not has_table_privilege('service_role','public.instructor_reward_reservations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
   and not has_table_privilege('authenticated','public.instructor_reward_payment_exceptions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
 'private_events',not has_function_privilege('authenticated','public.reward_credit_event(text,text)','EXECUTE')
   and not has_function_privilege('service_role','public.reward_credit_event(text,text)','EXECUTE'),
 'failure_service_only',has_function_privilege('service_role','public.record_reward_credit_payment_failure(text,text)','EXECUTE')
   and not has_function_privilege('authenticated','public.record_reward_credit_payment_failure(text,text)','EXECUTE'),
 's1_preserved',not has_function_privilege('anon','public.begin_order_payment_retry(text)','EXECUTE')
   and not has_function_privilege('authenticated','public.begin_order_payment_retry(text)','EXECUTE')
   and not has_function_privilege('authenticated','public.claim_order_payment(text,text)','EXECUTE')
   and has_function_privilege('service_role','public.claim_order_payment(text,text)','EXECUTE'),
 'account_ledger_agrees',not exists(select 1 from public.instructor_reward_accounts a left join(
   select instructor_id,sum(balance_delta) b,sum(pending_delta) p,sum(reserved_delta) r from public.instructor_reward_ledger group by instructor_id
   )l on l.instructor_id=a.user_id where a.balance<>coalesce(l.b,0) or a.pending_balance<>coalesce(l.p,0) or a.reserved_balance<>coalesce(l.r,0)),
 'running_balances_agree',not exists(select 1 from(
   select balance_after,pending_after,reserved_after,sum(balance_delta) over(partition by instructor_id order by id) b,
     sum(pending_delta) over(partition by instructor_id order by id) p,sum(reserved_delta) over(partition by instructor_id order by id) r
   from public.instructor_reward_ledger)h where balance_after<>b or pending_after<>p or reserved_after<>r),
 'reservations_agree',not exists(select 1 from public.instructor_reward_accounts a where a.reserved_balance<>
   coalesce((select sum(amount) from public.instructor_reward_reservations r where r.user_id=a.user_id and r.status='reserved'),0))
) verification;
rollback;
